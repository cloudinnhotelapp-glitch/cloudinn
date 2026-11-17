// Staff attendance at the active location. Who and where always come from the session; the device's position is only compared with the area the Super Admin set for that location. Raw coordinates are never stored or audited, and photos stay in private storage. A photo is attendance evidence only: no face recognition or liveness check is performed.
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { attendanceRoles, hasPermission, type AttendanceAction, type AttendanceReport, type AttendanceCorrectionSummary, type AttendanceDay, type AttendanceLocationCheck, type AttendanceManagement, type AttendanceMonth, type AttendanceNotice, type AttendanceRecordSummary, type AttendanceToday } from '@hms/shared';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessAuthService } from '../../auth/business-auth.service.js';
import { SessionSettingsService } from '../../auth/session/session-settings.service.js';
import { AuditLogService } from '../../audit-logs/audit-log.service.js';
import { isUniqueViolation } from '../../common/database/prisma-errors.js';
import type { ClientMeta } from '../../common/http/client-meta.js';
import type { PrivateFile } from '../../common/http/private-file.js';
import { businessUserActor } from '../../common/tenancy/property-scope.js';
import { locationScope } from '../../common/tenancy/tenant-scope.js';
import { addDays } from '../../reservations/reservation-rules.js';
import { dateOnly, formatDateOnly, timeInTimeZone, todayInTimeZone, zonedDateTime } from '../../common/time/location-date.js';
import { FILE_STORAGE, type FileStorage } from '../../file-storage/file-storage.js';
import type { UploadedFileInput } from '../../guests/documents/file-checks.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { createCaptureToken, distanceMeters, isValidCaptureToken, maxAccuracyMeters, verifySelfie } from './attendance-checks.js';
import type { AttendanceManagementQueryDto, AttendanceRangeDto, CreateCorrectionDto, CreateLeaveDayDto, PositionDto, PunchDto, ReviewCorrectionDto, StaffAttendanceQueryDto, VerifyLocationDto } from './attendance.dto.js';

// Names loaded with every record.
const WITH_NAMES = { location: { select: { id: true, name: true } }, user: { select: { id: true, name: true, role: true } } } as const;

// Names loaded with every correction.
const CORRECTION_NAMES = { ...WITH_NAMES, reviewedBy: { select: { id: true, name: true } } } as const;

// The longest date range one list may cover.
const MAX_RANGE_DAYS = 62;

// How many expired records one punch cleans up, so a punch never becomes slow.
const PURGE_BATCH = 50;

// A location row with its attendance settings.
type AttendanceLocation = Awaited<ReturnType<PrismaService['location']['findFirstOrThrow']>>;

// The result of measuring a device against a location's area.
interface MeasuredPosition {
  distanceMeters: number;
  accuracyMeters: number;
  radiusMeters: number;
  insideArea: boolean;
}

// Service holding the attendance rules.
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly sessions: SessionSettingsService,
    private readonly authService: BusinessAuthService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  // Today's attendance of the signed-in user at the active location, and any check-in still open anywhere.
  async today(auth: BusinessAuthContext): Promise<AttendanceToday> {
    const location = await this.activeLocation(auth);
    const date = todayInTimeZone(location.timezone);
    const scope = locationScope(auth);
    const [today, open, pending, decided, shift] = await Promise.all([
      this.prisma.attendanceRecord.findFirst({ where: { userId: auth.userId, ...scope, attendanceDate: dateOnly(date) }, include: WITH_NAMES }),
      this.prisma.attendanceRecord.findFirst({ where: { userId: auth.userId, businessId: auth.businessId, checkOutAt: null }, include: WITH_NAMES }),
      this.prisma.attendanceCorrection.count({ where: { userId: auth.userId, ...scope, attendanceDate: dateOnly(date), status: 'PENDING' } }),
      this.prisma.attendanceCorrection.findFirst({ where: { userId: auth.userId, businessId: auth.businessId, status: { in: ['APPROVED', 'REJECTED'] }, reviewedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { reviewedAt: 'desc' } }),
      this.assignedShift(auth.userId, auth.businessId, date),
    ]);
    const shiftStart = shift?.startTime ?? location.attendanceShiftStart;
    const earlierOpen = open !== null && formatDateOnly(open.attendanceDate) < date;
    const notices: AttendanceNotice[] = [];
    if (earlierOpen) notices.push({ kind: 'MISSING_PUNCH_OUT', tone: 'warning', message: `You did not punch out on ${formatDateOnly(open.attendanceDate)}. Request a correction from My Attendance; until then that day is not counted for salary.` });
    if (!today && !open && shiftStart && timeInTimeZone(location.timezone) >= shiftStart) notices.push({ kind: 'PUNCH_IN_REMINDER', tone: 'info', message: `Your ${shift ? `${shift.name} shift` : 'shift'} started at ${shiftStart}. Remember to punch in.` });
    if (today && today.lateMinutes > 0) notices.push({ kind: 'LATE_ARRIVAL', tone: 'warning', message: `You punched in ${today.lateMinutes} minutes late today.` });
    if (decided) notices.push({ kind: 'CORRECTION_DECISION', tone: decided.status === 'APPROVED' ? 'success' : 'error', message: `Your correction for ${formatDateOnly(decided.attendanceDate)} was ${decided.status === 'APPROVED' ? 'approved' : 'rejected'}.` });
    return {
      date,
      location: { id: location.id, name: location.name, configured: location.attendanceRadiusMeters !== null, enabled: location.attendanceEnabled, radiusMeters: location.attendanceRadiusMeters, checkInFrom: location.attendanceCheckInFrom, checkInUntil: location.attendanceCheckInUntil, checkOutPolicy: location.attendanceCheckOutPolicy, shiftStart },
      shift: shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime } : null,
      status: pending > 0 ? 'PENDING_VERIFICATION' : !today ? 'NOT_CHECKED_IN' : today.checkOutAt ? 'CHECKED_OUT' : 'CHECKED_IN',
      timing: !today || !shiftStart ? null : today.lateMinutes > 0 ? 'LATE' : 'ON_TIME',
      punches: today ? (today.checkOutAt ? 2 : 1) : 0,
      workingMinutes: today ? workingMinutes(today.checkInAt, today.checkOutAt ?? new Date()) : 0,
      today: today ? toSummary(today) : null,
      open: open ? toSummary(open) : null,
      earlierOpen,
      notices,
    };
  }

  // The shift assigned to a user on a date, if any (shifts belong to the business, so this holds at every location).
  private assignedShift(userId: string, businessId: string, date: string) {
    return this.prisma.staffShiftAssignment.findFirst({ where: { userId, businessId, shiftDate: dateOnly(date) }, select: { shift: { select: { name: true, startTime: true, endTime: true } } } }).then((row) => row?.shift ?? null);
  }

  // The location check before the camera opens: refuses a device that may not punch, and returns the token the photo must carry.
  async verifyLocation(auth: BusinessAuthContext, body: VerifyLocationDto, meta: ClientMeta): Promise<AttendanceLocationCheck> {
    const action: AttendanceAction = body.action ?? 'CHECK_IN';
    const location = await this.openForAttendance(auth);
    const date = todayInTimeZone(location.timezone);
    if (action === 'CHECK_IN') this.assertWithinWindow(location);
    else await this.findOpenHere(auth, location, date);
    const measured = await this.assertPosition(auth, location, body, action, meta);
    if (action === 'CHECK_IN') await this.assertCanCheckIn(auth, date);
    return { distanceMeters: measured.distanceMeters, radiusMeters: measured.radiusMeters, insideArea: measured.insideArea, captureToken: createCaptureToken(this.sessions.csrfSecret, auth.sessionId, tokenSubject(location.id, action), Date.now()) };
  }

  // Records a punch-in: position, token, and photo are all checked again here, because the browser's earlier steps prove nothing.
  async checkIn(auth: BusinessAuthContext, body: PunchDto, file: UploadedFileInput | undefined, meta: ClientMeta): Promise<AttendanceRecordSummary> {
    const location = await this.openForAttendance(auth);
    this.assertWithinWindow(location);
    const measured = await this.assertPosition(auth, location, body, 'CHECK_IN', meta);
    this.assertToken(auth, body, location.id, 'CHECK_IN');
    verifySelfie(file);
    const date = todayInTimeZone(location.timezone);
    await this.assertCanCheckIn(auth, date);

    const photo = await this.storePhoto(auth, file!);
    const shift = await this.assignedShift(auth.userId, auth.businessId, date);
    const now = new Date();
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const created = await tx.attendanceRecord.create({
          data: {
            ...locationScope(auth),
            userId: auth.userId,
            attendanceDate: dateOnly(date),
            checkInAt: now,
            locationVerified: true,
            checkInDistanceMeters: measured.distanceMeters,
            checkInAccuracyMeters: measured.accuracyMeters,
            lateMinutes: lateMinutes(location, date, now, shift?.startTime),
            selfieStorageKey: photo.key,
            selfieContentType: 'image/jpeg',
            selfieSizeBytes: photo.size,
            selfieSha256: photo.sha256,
          },
          include: WITH_NAMES,
        });
        await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'attendance.checked_in', entityType: 'AttendanceRecord', entityId: created.id, metadata: { distanceMeters: measured.distanceMeters, accuracyMeters: measured.accuracyMeters, lateMinutes: created.lateMinutes } }, tx);
        return created;
      });
      await this.purgeExpiredPhotos(location, meta);
      return toSummary(record);
    } catch (error) {
      await this.removePhoto(photo.key);
      if (isUniqueViolation(error)) throw new ConflictException('Your attendance is already recorded.');
      throw error;
    }
  }

  // Records the punch-out of the user's open attendance, with its own location check and photo.
  async checkOut(auth: BusinessAuthContext, body: PunchDto, file: UploadedFileInput | undefined, meta: ClientMeta): Promise<AttendanceRecordSummary> {
    const location = await this.openForAttendance(auth);
    const open = await this.findOpenHere(auth, location, todayInTimeZone(location.timezone));
    const measured = await this.assertPosition(auth, location, body, 'CHECK_OUT', meta);
    this.assertToken(auth, body, location.id, 'CHECK_OUT');
    verifySelfie(file);

    const photo = await this.storePhoto(auth, file!);
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.attendanceRecord.updateMany({
          where: { id: open.id, checkOutAt: null },
          data: { checkOutAt: new Date(), checkOutDistanceMeters: measured.distanceMeters, checkOutAccuracyMeters: measured.accuracyMeters, checkOutLocationVerified: measured.insideArea, checkOutSelfieStorageKey: photo.key, checkOutSelfieContentType: 'image/jpeg', checkOutSelfieSizeBytes: photo.size, checkOutSelfieSha256: photo.sha256 },
        });
        if (count === 0) throw new ConflictException('You have no active check-in to check out of.');
        await this.audit.record({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'attendance.checked_out', entityType: 'AttendanceRecord', entityId: open.id, metadata: { distanceMeters: measured.distanceMeters, accuracyMeters: measured.accuracyMeters, insideArea: measured.insideArea } }, tx);
        return tx.attendanceRecord.findUniqueOrThrow({ where: { id: open.id }, include: WITH_NAMES });
      });
      return toSummary(record);
    } catch (error) {
      await this.removePhoto(photo.key);
      throw error;
    }
  }

  // The signed-in user's own attendance at every location of the business, newest first.
  async mine(auth: BusinessAuthContext, query: AttendanceRangeDto): Promise<AttendanceRecordSummary[]> {
    const location = await this.activeLocation(auth);
    const range = dateRange(query, location.timezone);
    const rows = await this.prisma.attendanceRecord.findMany({ where: { userId: auth.userId, businessId: auth.businessId, attendanceDate: range }, include: WITH_NAMES, orderBy: { checkInAt: 'desc' } });
    return rows.map(toSummary);
  }

  // One month of the user's own attendance, day by day, with totals. Weekly days off are not modelled, so a past day with no record counts as absent.
  async month(auth: BusinessAuthContext, month: string): Promise<AttendanceMonth> {
    const location = await this.activeLocation(auth);
    const today = todayInTimeZone(location.timezone);
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const first = `${month}-01`;
    const last = formatDateOnly(new Date(Date.UTC(year, monthNumber, 0)));
    const window = { gte: dateOnly(first), lte: dateOnly(last) };
    const [user, records, leave, pending] = await Promise.all([
      this.prisma.businessUser.findUniqueOrThrow({ where: { id: auth.userId }, select: { createdAt: true, joiningDate: true } }),
      this.prisma.attendanceRecord.findMany({ where: { userId: auth.userId, businessId: auth.businessId, attendanceDate: window }, include: WITH_NAMES, orderBy: { checkInAt: 'asc' } }),
      this.prisma.staffLeaveDay.findMany({ where: { userId: auth.userId, businessId: auth.businessId, leaveDate: window } }),
      this.prisma.attendanceCorrection.findMany({ where: { userId: auth.userId, businessId: auth.businessId, attendanceDate: window, status: 'PENDING' }, select: { attendanceDate: true } }),
    ]);
    // Absences count from the joining date when one is recorded, otherwise from when the account was created.
    const joined = user.joiningDate ? formatDateOnly(user.joiningDate) : todayInTimeZone(location.timezone, user.createdAt);
    const leaveDates = new Set(leave.map((row) => formatDateOnly(row.leaveDate)));
    const pendingDates = new Set(pending.map((row) => formatDateOnly(row.attendanceDate)));
    const days: AttendanceDay[] = [];
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const dayRecords = records.filter((record) => formatDateOnly(record.attendanceDate) === date).map(toSummary);
      days.push({ date, status: dayStatus(date, today, joined, dayRecords, leaveDates.has(date), pendingDates.has(date)), records: dayRecords });
    }
    const summaries = days.flatMap((day) => day.records);
    return {
      month,
      today,
      days,
      stats: {
        totalMinutes: summaries.reduce((sum, record) => sum + (record.workingMinutes ?? 0), 0),
        punches: summaries.reduce((sum, record) => sum + (record.checkOutAt ? 2 : 1), 0),
        onTime: summaries.filter((record) => !record.late).length,
        late: summaries.filter((record) => record.late).length,
        presentDays: days.filter((day) => day.records.length > 0).length,
        absentDays: days.filter((day) => day.status === 'ABSENT').length,
        leaveDays: days.filter((day) => day.status === 'LEAVE').length,
        missingPunches: days.filter((day) => day.status === 'MISSING_PUNCH').length,
      },
    };
  }

  // Attendance of the staff at the active location, newest first.
  async staff(auth: BusinessAuthContext, query: StaffAttendanceQueryDto): Promise<AttendanceRecordSummary[]> {
    const location = await this.activeLocation(auth);
    const range = dateRange(query, location.timezone);
    const rows = await this.prisma.attendanceRecord.findMany({ where: { ...locationScope(auth), attendanceDate: range, ...(query.userId ? { userId: query.userId } : {}) }, include: WITH_NAMES, orderBy: { checkInAt: 'desc' } });
    return rows.map(toSummary);
  }

  // The management screen: records, absences, and leave for one of the reviewer's own locations.
  async management(auth: BusinessAuthContext, query: AttendanceManagementQueryDto): Promise<AttendanceManagement> {
    const locationId = query.locationId ?? locationScope(auth).locationId;
    if (!(await this.authService.isAssignedActiveLocation(auth.userId, auth.businessId, locationId))) throw new ForbiddenException('You are not assigned to this location.');
    const location = await this.prisma.location.findFirstOrThrow({ where: { id: locationId, businessId: auth.businessId } });
    const range = dateRange(query, location.timezone);
    const scope = { businessId: auth.businessId, locationId };
    const staff = await this.staffOfLocation(scope);
    const chosen = query.userId ? staff.filter((user) => user.id === query.userId) : staff;
    const ids = chosen.map((user) => user.id);
    const [records, leaveDays, pendingCorrections] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { ...scope, userId: { in: ids }, attendanceDate: range }, include: WITH_NAMES, orderBy: { checkInAt: 'desc' } }),
      this.prisma.staffLeaveDay.findMany({ where: { businessId: auth.businessId, userId: { in: ids }, leaveDate: range }, include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { leaveDate: 'desc' } }),
      this.prisma.attendanceCorrection.count({ where: { ...scope, status: 'PENDING' } }),
    ]);
    const from = formatDateOnly(range.gte);
    const to = formatDateOnly(range.lte);
    const today = todayInTimeZone(location.timezone);
    const absences: AttendanceManagement['absences'] = [];
    for (let date = to < today ? to : addDays(today, -1); date >= from; date = addDays(date, -1)) {
      for (const user of chosen) {
        const covered = records.some((record) => record.userId === user.id && formatDateOnly(record.attendanceDate) === date) || leaveDays.some((leave) => leave.userId === user.id && formatDateOnly(leave.leaveDate) === date);
        if (!covered && date >= (user.joiningDate ? formatDateOnly(user.joiningDate) : todayInTimeZone(location.timezone, user.createdAt))) absences.push({ date, user: { id: user.id, name: user.name, role: user.role } });
      }
    }
    return { location: { id: location.id, name: location.name }, from, to, staff, records: records.map(toSummary), absences, leaveDays: leaveDays.map((leave) => ({ id: leave.id, date: formatDateOnly(leave.leaveDate), note: leave.note, user: leave.user })), pendingCorrections };
  }

  // One month's figures per staff member of the active location, from the records at this location: present (punched out
  // or corrected), late, incomplete (an earlier day with no punch-out), approved leave, and absent (a past day from the
  // joining date with none of these; weekly days off are not modelled).
  async report(auth: BusinessAuthContext, month: string): Promise<AttendanceReport> {
    const scope = locationScope(auth);
    const location = await this.activeLocation(auth);
    const today = todayInTimeZone(location.timezone);
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const first = `${month}-01`;
    const last = formatDateOnly(new Date(Date.UTC(year, monthNumber, 0)));
    const window = { gte: dateOnly(first), lte: dateOnly(last) };
    const staff = await this.prisma.businessUser.findMany({
      where: { businessId: scope.businessId, status: 'ACTIVE', archivedAt: null, role: { in: attendanceRoles() }, locationAssignments: { some: { locationId: scope.locationId } } },
      select: { id: true, name: true, role: true, employeeCode: true, createdAt: true, joiningDate: true },
      orderBy: { name: 'asc' },
    });
    const ids = staff.map((user) => user.id);
    const [records, leave] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { ...scope, userId: { in: ids }, attendanceDate: window }, select: { userId: true, attendanceDate: true, checkInAt: true, checkOutAt: true, lateMinutes: true } }),
      this.prisma.staffLeaveDay.findMany({ where: { businessId: scope.businessId, userId: { in: ids }, leaveDate: window }, select: { userId: true, leaveDate: true } }),
    ]);
    const rows = staff.map((user) => {
      const own = records.filter((record) => record.userId === user.id);
      const complete = own.filter((record) => record.checkOutAt);
      const present = new Set(complete.map((record) => formatDateOnly(record.attendanceDate)));
      const incomplete = new Set(own.filter((record) => !record.checkOutAt && formatDateOnly(record.attendanceDate) < today).map((record) => formatDateOnly(record.attendanceDate)).filter((date) => !present.has(date)));
      const leaveDates = new Set(leave.filter((row) => row.userId === user.id).map((row) => formatDateOnly(row.leaveDate)).filter((date) => !present.has(date)));
      const joined = user.joiningDate ? formatDateOnly(user.joiningDate) : todayInTimeZone(location.timezone, user.createdAt);
      let absent = 0;
      for (let date = first; date <= last && date < today; date = addDays(date, 1)) {
        if (date >= joined && !present.has(date) && !incomplete.has(date) && !leaveDates.has(date) && !own.some((record) => formatDateOnly(record.attendanceDate) === date)) absent += 1;
      }
      return {
        user: { id: user.id, name: user.name, role: user.role, employeeCode: user.employeeCode },
        presentDays: present.size,
        lateDays: new Set(complete.filter((record) => record.lateMinutes > 0).map((record) => formatDateOnly(record.attendanceDate))).size,
        incompleteDays: incomplete.size,
        leaveDays: leaveDates.size,
        absentDays: absent,
        workingMinutes: complete.reduce((sum, record) => sum + workingMinutes(record.checkInAt, record.checkOutAt!), 0),
      };
    });
    return { month, location: { id: location.id, name: location.name }, rows };
  }

  // Returns a photo to its owner, or to staff allowed to view the active location's attendance; every view is audited.
  async selfie(auth: BusinessAuthContext, recordId: string, kind: 'check-in' | 'check-out', meta: ClientMeta): Promise<PrivateFile> {
    const record = await this.prisma.attendanceRecord.findFirst({ where: { id: recordId, businessId: auth.businessId } });
    const own = record?.userId === auth.userId;
    const asStaffViewer = record?.locationId === auth.activeLocationId && hasPermission(auth.role, 'attendance.viewStaff');
    if (!record || (!own && !asStaffViewer)) throw new NotFoundException('Attendance record not found.');
    const key = kind === 'check-out' ? record.checkOutSelfieStorageKey : record.selfieStorageKey;
    if (!key || record.selfiePurgedAt) throw new NotFoundException('This photo is not available.');
    const content = await this.storage.read(key);
    if (!content) {
      this.logger.warn(`A photo of attendance record ${record.id} is missing.`);
      throw new NotFoundException('This photo is not available.');
    }
    await this.audit.record({ ...businessUserActor(auth, meta), businessId: record.businessId, locationId: record.locationId, action: 'attendance.selfie_viewed', entityType: 'AttendanceRecord', entityId: record.id, metadata: { staffUserId: record.userId, kind } });
    return { fileName: 'attendance-photo.jpg', contentType: 'image/jpeg', content };
  }

  // Lets an Admin close a check-in the staff member forgot, with a reason and the time they actually left; no time is ever assumed.
  async close(auth: BusinessAuthContext, recordId: string, reason: string, checkOut: string, meta: ClientMeta): Promise<AttendanceRecordSummary> {
    const scope = locationScope(auth);
    const record = await this.prisma.attendanceRecord.findFirst({ where: { id: recordId, ...scope } });
    if (!record) throw new NotFoundException('Attendance record not found.');
    const location = await this.activeLocation(auth);
    const checkOutAt = zonedDateTime(formatDateOnly(record.attendanceDate), checkOut, location.timezone);
    if (checkOutAt <= record.checkInAt) throw new BadRequestException(['The punch-out time must be after the punch-in time.']);
    if (checkOutAt > new Date()) throw new BadRequestException(['The time cannot be in the future.']);
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.attendanceRecord.updateMany({ where: { id: record.id, checkOutAt: null }, data: { checkOutAt, closedByUserId: auth.userId, closeReason: reason } });
      if (count === 0) throw new ConflictException('This attendance is already checked out.');
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'attendance.closed', entityType: 'AttendanceRecord', entityId: record.id, metadata: { staffUserId: record.userId, checkOutAt: checkOutAt.toISOString() } }, tx);
      return tx.attendanceRecord.findUniqueOrThrow({ where: { id: record.id }, include: WITH_NAMES });
    });
    return toSummary(updated);
  }

  // Files a correction request for the signed-in user at the active location; nothing changes until it is approved.
  async requestCorrection(auth: BusinessAuthContext, dto: CreateCorrectionDto, meta: ClientMeta): Promise<AttendanceCorrectionSummary> {
    const location = await this.activeLocation(auth);
    const scope = locationScope(auth);
    const today = todayInTimeZone(location.timezone);
    assertRealDate(dto.date);
    if (dto.date > today) throw new BadRequestException(['Choose today or an earlier date.']);
    if (dto.date < addDays(today, -MAX_RANGE_DAYS)) throw new BadRequestException([`Corrections can go back ${MAX_RANGE_DAYS} days.`]);
    if (dto.type === 'FORGOT_CHECK_OUT' && !dto.checkOut) throw new BadRequestException(['Enter the punch-out time.']);
    if ((dto.type === 'FORGOT_CHECK_IN' || dto.type === 'LOCATION_PROBLEM') && !dto.checkIn) throw new BadRequestException(['Enter the punch-in time.']);
    if (dto.type === 'WRONG_TIME' && !dto.checkIn && !dto.checkOut) throw new BadRequestException(['Enter the correct time.']);
    const requestedCheckInAt = dto.checkIn ? zonedDateTime(dto.date, dto.checkIn, location.timezone) : null;
    const requestedCheckOutAt = dto.checkOut ? zonedDateTime(dto.date, dto.checkOut, location.timezone) : null;
    if (requestedCheckInAt && requestedCheckOutAt && requestedCheckOutAt <= requestedCheckInAt) throw new BadRequestException(['The punch-out time must be after the punch-in time.']);
    if ((requestedCheckInAt && requestedCheckInAt > new Date()) || (requestedCheckOutAt && requestedCheckOutAt > new Date())) throw new BadRequestException(['The time cannot be in the future.']);
    const record = await this.prisma.attendanceRecord.findFirst({ where: { userId: auth.userId, ...scope, attendanceDate: dateOnly(dto.date) } });
    if (dto.type === 'FORGOT_CHECK_OUT' && !record) throw new BadRequestException(['There is no punch-in on that date. Choose “Forgot to punch in”.']);
    if (dto.type === 'FORGOT_CHECK_IN' && record) throw new BadRequestException(['There is already a punch-in on that date. Choose “Incorrect attendance time”.']);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.attendanceCorrection.create({
          data: { ...scope, userId: auth.userId, attendanceRecordId: record?.id ?? null, attendanceDate: dateOnly(dto.date), type: dto.type, requestedCheckInAt, requestedCheckOutAt, reason: dto.reason.trim() },
          include: CORRECTION_NAMES,
        });
        await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'attendance.correction_requested', entityType: 'AttendanceCorrection', entityId: row.id, metadata: { type: dto.type, date: dto.date } }, tx);
        return row;
      });
      return toCorrection(created);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('You already have a pending correction for that date.');
      throw error;
    }
  }

  // The signed-in user's own correction requests, newest first.
  async myCorrections(auth: BusinessAuthContext): Promise<AttendanceCorrectionSummary[]> {
    const rows = await this.prisma.attendanceCorrection.findMany({ where: { userId: auth.userId, businessId: auth.businessId }, include: CORRECTION_NAMES, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map(toCorrection);
  }

  // Correction requests of the active location, for reviewers.
  async correctionQueue(auth: BusinessAuthContext, status: 'PENDING' | 'APPROVED' | 'REJECTED' = 'PENDING'): Promise<AttendanceCorrectionSummary[]> {
    const rows = await this.prisma.attendanceCorrection.findMany({ where: { ...locationScope(auth), status }, include: CORRECTION_NAMES, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(toCorrection);
  }

  // Approves or rejects a request; nobody can decide their own, and an approval changes the record and the audit log together.
  async reviewCorrection(auth: BusinessAuthContext, id: string, dto: ReviewCorrectionDto, meta: ClientMeta): Promise<AttendanceCorrectionSummary> {
    const scope = locationScope(auth);
    const correction = await this.prisma.attendanceCorrection.findFirst({ where: { id, ...scope } });
    if (!correction) throw new NotFoundException('Correction not found.');
    if (correction.userId === auth.userId) throw new ForbiddenException('You cannot decide your own correction request.');
    if (correction.status !== 'PENDING') throw new ConflictException('This request has already been decided.');
    if (dto.decision === 'REJECT' && !dto.note?.trim()) throw new BadRequestException(['Enter a note explaining the rejection.']);
    const location = await this.activeLocation(auth);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.attendanceCorrection.updateMany({ where: { id, status: 'PENDING' }, data: { status: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedByUserId: auth.userId, reviewedAt: new Date(), reviewNote: dto.note?.trim() || null } });
        if (count === 0) throw new ConflictException('This request has already been decided.');
        let change: Record<string, string | null> = {};
        if (dto.decision === 'APPROVE') {
          const date = formatDateOnly(correction.attendanceDate);
          const existing = await tx.attendanceRecord.findFirst({ where: { userId: correction.userId, ...scope, attendanceDate: correction.attendanceDate } });
          const checkInAt = correction.requestedCheckInAt ?? existing?.checkInAt ?? null;
          const checkOutAt = correction.requestedCheckOutAt ?? existing?.checkOutAt ?? null;
          if (!checkInAt) throw new ConflictException('This request has no punch-in time to apply.');
          if (checkOutAt && checkOutAt <= checkInAt) throw new BadRequestException(['The punch-out time must be after the punch-in time.']);
          if (!checkOutAt && date < todayInTimeZone(location.timezone)) throw new BadRequestException(['A past day needs a punch-out time. Reject this request and ask for one with both times.']);
          const shift = await this.assignedShift(correction.userId, correction.businessId, date);
          const times = { checkInAt, checkOutAt, lateMinutes: lateMinutes(location, date, checkInAt, shift?.startTime) };
          const record = existing
            ? await tx.attendanceRecord.update({ where: { id: existing.id }, data: times })
            : await tx.attendanceRecord.create({ data: { ...scope, userId: correction.userId, attendanceDate: correction.attendanceDate, source: 'CORRECTION', locationVerified: false, ...times } });
          await tx.attendanceCorrection.update({ where: { id }, data: { attendanceRecordId: record.id } });
          change = { before: existing ? `${existing.checkInAt.toISOString()} / ${existing.checkOutAt?.toISOString() ?? 'none'}` : null, after: `${checkInAt.toISOString()} / ${checkOutAt?.toISOString() ?? 'none'}`, recordId: record.id };
        }
        await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: dto.decision === 'APPROVE' ? 'attendance.correction_approved' : 'attendance.correction_rejected', entityType: 'AttendanceCorrection', entityId: id, metadata: { staffUserId: correction.userId, type: correction.type, ...change } }, tx);
        return tx.attendanceCorrection.findUniqueOrThrow({ where: { id }, include: CORRECTION_NAMES });
      });
      return toCorrection(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('This staff member has another open attendance. Close that first.');
      throw error;
    }
  }

  // Records an approved leave day for a staff member of the active location.
  async addLeaveDay(auth: BusinessAuthContext, dto: CreateLeaveDayDto, meta: ClientMeta): Promise<{ id: string }> {
    const scope = locationScope(auth);
    assertRealDate(dto.date);
    if (!(await this.staffOfLocation(scope)).some((user) => user.id === dto.userId)) throw new NotFoundException('Staff member not found.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.staffLeaveDay.create({ data: { businessId: scope.businessId, userId: dto.userId, leaveDate: dateOnly(dto.date), note: dto.note?.trim() || null, approvedByUserId: auth.userId } });
        await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'attendance.leave_recorded', entityType: 'StaffLeaveDay', entityId: row.id, metadata: { staffUserId: dto.userId, date: dto.date } }, tx);
        return { id: row.id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A leave day is already recorded for that date.');
      throw error;
    }
  }

  // Removes a leave day of a staff member of the active location.
  async removeLeaveDay(auth: BusinessAuthContext, id: string, meta: ClientMeta): Promise<void> {
    const scope = locationScope(auth);
    const row = await this.prisma.staffLeaveDay.findFirst({ where: { id, businessId: scope.businessId } });
    if (!row || !(await this.staffOfLocation(scope)).some((user) => user.id === row.userId)) throw new NotFoundException('Leave day not found.');
    await this.prisma.$transaction(async (tx) => {
      await tx.staffLeaveDay.delete({ where: { id } });
      await this.audit.record({ ...businessUserActor(auth, meta), ...scope, action: 'attendance.leave_removed', entityType: 'StaffLeaveDay', entityId: id, metadata: { staffUserId: row.userId, date: formatDateOnly(row.leaveDate) } }, tx);
    });
  }

  // Loads the session's active location with its attendance settings.
  private activeLocation(auth: BusinessAuthContext): Promise<AttendanceLocation> {
    return this.prisma.location.findFirstOrThrow({ where: { id: locationScope(auth).locationId, businessId: auth.businessId } });
  }

  // Loads the active location and refuses when attendance is switched off or not set up.
  private async openForAttendance(auth: BusinessAuthContext): Promise<AttendanceLocation> {
    const location = await this.activeLocation(auth);
    if (location.attendanceRadiusMeters === null) throw new ConflictException(`Attendance is not set up for ${location.name} yet. A Super Admin must set its attendance area.`);
    if (!location.attendanceEnabled) throw new ConflictException(`Attendance is turned off for ${location.name}.`);
    return location;
  }

  // Refuses a punch-in outside the location's allowed window.
  private assertWithinWindow(location: AttendanceLocation): void {
    if (!location.attendanceCheckInFrom || !location.attendanceCheckInUntil) return;
    const now = timeInTimeZone(location.timezone);
    if (now < location.attendanceCheckInFrom || now > location.attendanceCheckInUntil) throw new ForbiddenException(`Punch-in is allowed from ${location.attendanceCheckInFrom} to ${location.attendanceCheckInUntil}.`);
  }

  // Finds the user's open attendance when it can be punched out here today, or explains why it cannot.
  private async findOpenHere(auth: BusinessAuthContext, location: AttendanceLocation, date: string) {
    const open = await this.prisma.attendanceRecord.findFirst({ where: { userId: auth.userId, businessId: auth.businessId, checkOutAt: null }, include: { location: { select: { name: true } } } });
    if (!open) throw new ConflictException('You have no active check-in to check out of.');
    if (open.locationId !== location.id) throw new ConflictException(`You checked in at ${open.location.name}. Switch to that location to check out.`);
    if (formatDateOnly(open.attendanceDate) < date) throw new ConflictException(`Your attendance from ${formatDateOnly(open.attendanceDate)} is still open. Request a correction from My Attendance.`);
    return open;
  }

  // Refuses a second open check-in anywhere, or a repeat at this location today.
  private async assertCanCheckIn(auth: BusinessAuthContext, date: string): Promise<void> {
    const open = await this.prisma.attendanceRecord.findFirst({ where: { userId: auth.userId, businessId: auth.businessId, checkOutAt: null }, include: { location: { select: { name: true } } } });
    if (open) {
      if (formatDateOnly(open.attendanceDate) < date) throw new ConflictException(`Your attendance from ${formatDateOnly(open.attendanceDate)} is still open. Request a correction from My Attendance.`);
      throw new ConflictException(`You are already checked in at ${open.location.name}. Check out first.`);
    }
    const done = await this.prisma.attendanceRecord.count({ where: { userId: auth.userId, ...locationScope(auth), attendanceDate: dateOnly(date) } });
    if (done > 0) throw new ConflictException('You have already completed your attendance at this location today.');
  }

  // Refuses an expired or forged token, or one issued for the other kind of punch.
  private assertToken(auth: BusinessAuthContext, body: PunchDto, locationId: string, action: AttendanceAction): void {
    if (!isValidCaptureToken(this.sessions.csrfSecret, body.captureToken, auth.sessionId, tokenSubject(locationId, action), Date.now())) {
      throw new BadRequestException(['Your location check has expired. Start again.']);
    }
  }

  // Compares the device's reported position with the location's area; a refusal creates nothing and is audited by distance only. A punch-out may be accepted outside the area when the location's policy says so.
  private async assertPosition(auth: BusinessAuthContext, location: AttendanceLocation, position: PositionDto, action: AttendanceAction, meta: ClientMeta): Promise<MeasuredPosition> {
    const radiusMeters = location.attendanceRadiusMeters!;
    const distance = distanceMeters({ latitude: location.attendanceLatitude!.toNumber(), longitude: location.attendanceLongitude!.toNumber() }, position);
    const accuracyMeters = Math.ceil(position.accuracy);
    const insideArea = distance <= radiusMeters && accuracyMeters <= maxAccuracyMeters(radiusMeters);
    if (insideArea || (action === 'CHECK_OUT' && location.attendanceCheckOutPolicy === 'ANY_LOCATION')) return { distanceMeters: distance, accuracyMeters, radiusMeters, insideArea };
    await this.audit.recordSafely({ ...businessUserActor(auth, meta), ...locationScope(auth), action: 'attendance.location_rejected', entityType: 'Location', entityId: location.id, metadata: { stage: action === 'CHECK_IN' ? 'check_in' : 'check_out', distanceMeters: distance, accuracyMeters, radiusMeters } });
    if (distance > radiusMeters) throw new ForbiddenException(`Attendance can only be recorded at the office. You are about ${distance} m from ${location.name}; you must be within ${radiusMeters} m of it.`);
    throw new ForbiddenException(`Your device could only find your position to within ${accuracyMeters} m. Move near a window or turn on precise location, then try again.`);
  }

  // Stores a verified photo under a new random private key.
  private async storePhoto(auth: BusinessAuthContext, file: UploadedFileInput): Promise<{ key: string; size: number; sha256: string }> {
    const key = `attendance-selfies/${auth.businessId}/${randomUUID()}`;
    await this.storage.put(key, file.buffer);
    return { key, size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex') };
  }

  // Removes a stored photo after its record could not be saved.
  private async removePhoto(key: string): Promise<void> {
    await this.storage.delete(key).catch(() => this.logger.warn('Could not remove a stored photo after a failed punch.'));
  }

  // Deletes photos older than the location's retention period, a small batch per punch, and keeps the attendance records.
  private async purgeExpiredPhotos(location: AttendanceLocation, meta: ClientMeta): Promise<void> {
    if (location.attendancePhotoRetentionDays === null) return;
    const cutoff = addDays(todayInTimeZone(location.timezone), -location.attendancePhotoRetentionDays);
    const expired = await this.prisma.attendanceRecord.findMany({ where: { locationId: location.id, selfiePurgedAt: null, selfieStorageKey: { not: null }, attendanceDate: { lt: dateOnly(cutoff) } }, take: PURGE_BATCH, select: { id: true, selfieStorageKey: true, checkOutSelfieStorageKey: true } });
    if (expired.length === 0) return;
    try {
      for (const record of expired) {
        for (const key of [record.selfieStorageKey, record.checkOutSelfieStorageKey]) if (key) await this.storage.delete(key);
      }
      await this.prisma.attendanceRecord.updateMany({ where: { id: { in: expired.map((record) => record.id) } }, data: { selfiePurgedAt: new Date() } });
      await this.audit.recordSafely({ actorType: 'SYSTEM', businessId: location.businessId, locationId: location.id, action: 'attendance.photos_purged', entityType: 'Location', entityId: location.id, metadata: { records: expired.length, retentionDays: location.attendancePhotoRetentionDays }, ...meta });
    } catch {
      this.logger.warn(`Could not finish removing expired attendance photos of location ${location.id}.`);
    }
  }

  // The active staff assigned to a location.
  private staffOfLocation(scope: { businessId: string; locationId: string }) {
    return this.prisma.businessUser.findMany({ where: { businessId: scope.businessId, status: 'ACTIVE', archivedAt: null, role: { in: attendanceRoles() }, locationAssignments: { some: { locationId: scope.locationId } } }, select: { id: true, name: true, role: true, createdAt: true, joiningDate: true }, orderBy: { name: 'asc' } });
  }
}

// What a capture token is issued for: one location and one kind of punch.
function tokenSubject(locationId: string, action: AttendanceAction): string {
  return `${locationId}:${action}`;
}

// Whole minutes between two moments.
function workingMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

// Minutes beyond the shift start and grace period; 0 when on time or when no shift start is set.
// The start is the assigned shift's when the user has one that day, otherwise the location's shift start.
function lateMinutes(location: AttendanceLocation, date: string, checkInAt: Date, shiftStart?: string | null): number {
  const startTime = shiftStart ?? location.attendanceShiftStart;
  if (!startTime) return 0;
  const start = zonedDateTime(date, startTime, location.timezone);
  return Math.max(0, workingMinutes(start, checkInAt) - location.attendanceLateGraceMinutes);
}

// Decides how a calendar day is shown.
function dayStatus(date: string, today: string, joined: string, records: AttendanceRecordSummary[], onLeave: boolean, pending: boolean): AttendanceDay['status'] {
  if (pending) return 'PENDING';
  if (records.some((record) => !record.checkOutAt && date < today)) return 'MISSING_PUNCH';
  if (records.length > 0) return records.some((record) => record.late) ? 'LATE' : 'PRESENT';
  if (onLeave) return 'LEAVE';
  return date < today && date >= joined ? 'ABSENT' : 'NONE';
}

// Refuses a date that does not exist, such as 31 February.
function assertRealDate(value: string): void {
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || formatDateOnly(dateOnly(value)) !== value) throw new BadRequestException(['Enter real dates.']);
}

// Turns a query's dates into a checked database range; the default is the last 31 days.
function dateRange(query: AttendanceRangeDto, timezone: string): { gte: Date; lte: Date } {
  const to = query.to ?? todayInTimeZone(timezone);
  const from = query.from ?? addDays(to, -30);
  for (const value of [from, to]) assertRealDate(value);
  if (from > to) throw new BadRequestException(['The start date must not be after the end date.']);
  if (from < addDays(to, -MAX_RANGE_DAYS)) throw new BadRequestException([`Choose at most ${MAX_RANGE_DAYS} days.`]);
  return { gte: dateOnly(from), lte: dateOnly(to) };
}

// Converts a record into the API response (never a storage key or checksum).
function toSummary(row: {
  id: string;
  attendanceDate: Date;
  checkInAt: Date;
  checkOutAt: Date | null;
  locationVerified: boolean;
  checkOutLocationVerified: boolean | null;
  checkInDistanceMeters: number | null;
  checkOutDistanceMeters: number | null;
  source: 'PUNCH' | 'CORRECTION';
  lateMinutes: number;
  selfieStorageKey: string | null;
  checkOutSelfieStorageKey: string | null;
  selfiePurgedAt: Date | null;
  closedByUserId: string | null;
  closeReason: string | null;
  location: { id: string; name: string };
  user: { id: string; name: string; role: AttendanceRecordSummary['user']['role'] };
}): AttendanceRecordSummary {
  return {
    id: row.id,
    date: formatDateOnly(row.attendanceDate),
    checkInAt: row.checkInAt.toISOString(),
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    location: row.location,
    user: row.user,
    locationVerified: row.locationVerified,
    checkOutLocationVerified: row.checkOutLocationVerified,
    checkInDistanceMeters: row.checkInDistanceMeters,
    checkOutDistanceMeters: row.checkOutDistanceMeters,
    source: row.source,
    late: row.lateMinutes > 0,
    lateMinutes: row.lateMinutes,
    workingMinutes: row.checkOutAt ? workingMinutes(row.checkInAt, row.checkOutAt) : null,
    hasCheckInPhoto: row.selfieStorageKey !== null && row.selfiePurgedAt === null,
    hasCheckOutPhoto: row.checkOutSelfieStorageKey !== null && row.selfiePurgedAt === null,
    closedByAdmin: row.closedByUserId !== null,
    closeReason: row.closeReason,
  };
}

// Converts a correction into the API response.
function toCorrection(row: {
  id: string;
  attendanceDate: Date;
  type: AttendanceCorrectionSummary['type'];
  requestedCheckInAt: Date | null;
  requestedCheckOutAt: Date | null;
  reason: string;
  status: AttendanceCorrectionSummary['status'];
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  reviewedBy: { id: string; name: string } | null;
  user: AttendanceCorrectionSummary['user'];
  location: { id: string; name: string };
}): AttendanceCorrectionSummary {
  return {
    id: row.id,
    date: formatDateOnly(row.attendanceDate),
    type: row.type,
    requestedCheckInAt: row.requestedCheckInAt?.toISOString() ?? null,
    requestedCheckOutAt: row.requestedCheckOutAt?.toISOString() ?? null,
    reason: row.reason,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewedBy,
    user: row.user,
    location: row.location,
    createdAt: row.createdAt.toISOString(),
  };
}
