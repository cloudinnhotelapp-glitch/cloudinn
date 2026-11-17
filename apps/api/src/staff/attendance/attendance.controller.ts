// Attendance endpoints for business users (/api/v1/attendance), always for the signed-in user and active location from the session; staff lists, reviews, and closing a check-in need their own permissions.
import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ATTENDANCE_SELFIE_MAX_BYTES, SESSION_COOKIES, type AttendanceCorrectionSummary, type AttendanceLocationCheck, type AttendanceManagement, type AttendanceMonth, type AttendanceRecordSummary, type AttendanceReport, type AttendanceToday } from '@hms/shared';
import type { BusinessAuthContext } from '../../auth/auth-context.js';
import { BusinessSessionGuard } from '../../auth/business-session.guard.js';
import { AllowStaff, CurrentBusinessUser, RequireActiveLocation, RequirePermissions } from '../../auth/decorators/auth.decorators.js';
import { getClientMeta } from '../../common/http/client-meta.js';
import { sendPrivateFile, singleFileUpload } from '../../common/http/private-file.js';
import type { UploadedFileInput } from '../../guests/documents/file-checks.js';
import { AttendanceManagementQueryDto, AttendanceMonthQueryDto, AttendanceReportQueryDto, AttendanceRangeDto, CloseAttendanceDto, CorrectionQueueQueryDto, CreateCorrectionDto, CreateLeaveDayDto, PunchDto, ReviewCorrectionDto, StaffAttendanceQueryDto, VerifyLocationDto } from './attendance.dto.js';
import { AttendanceService } from './attendance.service.js';

// Attendance of the signed-in user and, with permission, of the location's staff. Each route names its own permission:
// the user's own attendance needs attendance.self (Managers, Receptionists, and Staff; Admins do not keep attendance), and the
// staff, review, and management routes need theirs. Staff sessions may use these routes but only hold attendance.self.
// The photo routes need no permission of their own: the service shows a photo only to its owner or to a staff viewer.
@ApiTags('attendance')
@AllowStaff()
@ApiCookieAuth(SESSION_COOKIES.businessUser.session)
@UseGuards(BusinessSessionGuard)
@RequireActiveLocation()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // Today's state for the Attendance page.
  @Get('today')
  @RequirePermissions('attendance.self')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Today’s attendance of the current user' })
  today(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<AttendanceToday> {
    return this.attendance.today(auth);
  }

  // Checks the device may punch before the camera opens.
  @Post('verify-location')
  @RequirePermissions('attendance.self')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check the device is inside the attendance area' })
  verifyLocation(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: VerifyLocationDto, @Req() req: Request): Promise<AttendanceLocationCheck> {
    return this.attendance.verifyLocation(auth, body, getClientMeta(req));
  }

  // Records a punch-in with the camera photo (multipart field "selfie").
  @Post('check-in')
  @RequirePermissions('attendance.self')
  @UseInterceptors(singleFileUpload('selfie', ATTENDANCE_SELFIE_MAX_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Punch in with a camera photo' })
  checkIn(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: PunchDto, @UploadedFile() file: UploadedFileInput | undefined, @Req() req: Request): Promise<AttendanceRecordSummary> {
    return this.attendance.checkIn(auth, body, file, getClientMeta(req));
  }

  // Records a punch-out with the camera photo (multipart field "selfie").
  @Post('check-out')
  @RequirePermissions('attendance.self')
  @HttpCode(200)
  @UseInterceptors(singleFileUpload('selfie', ATTENDANCE_SELFIE_MAX_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Punch out with a camera photo' })
  checkOut(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: PunchDto, @UploadedFile() file: UploadedFileInput | undefined, @Req() req: Request): Promise<AttendanceRecordSummary> {
    return this.attendance.checkOut(auth, body, file, getClientMeta(req));
  }

  // The user's own attendance.
  @Get('mine')
  @RequirePermissions('attendance.self')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Own attendance history' })
  mine(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: AttendanceRangeDto): Promise<AttendanceRecordSummary[]> {
    return this.attendance.mine(auth, query);
  }

  // One month of the user's own attendance.
  @Get('month')
  @RequirePermissions('attendance.self')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Own attendance by day for a month' })
  month(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: AttendanceMonthQueryDto): Promise<AttendanceMonth> {
    return this.attendance.month(auth, query.month);
  }

  // Attendance of the active location's staff.
  @Get('records')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('attendance.viewStaff')
  @ApiOperation({ summary: 'Staff attendance at the active location' })
  staff(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: StaffAttendanceQueryDto): Promise<AttendanceRecordSummary[]> {
    return this.attendance.staff(auth, query);
  }

  // Records, absences, and leave for the management screen.
  @Get('management')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('attendance.viewStaff')
  @ApiOperation({ summary: 'Attendance management view' })
  management(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: AttendanceManagementQueryDto): Promise<AttendanceManagement> {
    return this.attendance.management(auth, query);
  }

  // One month's attendance figures for every staff member of the active location.
  @Get('report')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('attendance.viewStaff')
  @ApiOperation({ summary: 'Monthly staff attendance report' })
  report(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: AttendanceReportQueryDto): Promise<AttendanceReport> {
    return this.attendance.report(auth, query.month);
  }

  // Streams a punch-in photo through this authorized route; it never has a public link.
  @Get('records/:recordId/selfie')
  @ApiOperation({ summary: 'View a punch-in photo' })
  async selfie(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('recordId', ParseUUIDPipe) recordId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendPrivateFile(res, await this.attendance.selfie(auth, recordId, 'check-in', getClientMeta(req)), 'inline');
  }

  // Streams a punch-out photo through this authorized route.
  @Get('records/:recordId/check-out-selfie')
  @ApiOperation({ summary: 'View a punch-out photo' })
  async checkOutSelfie(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('recordId', ParseUUIDPipe) recordId: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return sendPrivateFile(res, await this.attendance.selfie(auth, recordId, 'check-out', getClientMeta(req)), 'inline');
  }

  // Closes a forgotten check-in.
  @Post('records/:recordId/close')
  @HttpCode(200)
  @RequirePermissions('attendance.manage')
  @ApiOperation({ summary: 'Close a forgotten check-in' })
  close(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('recordId', ParseUUIDPipe) recordId: string, @Body() body: CloseAttendanceDto, @Req() req: Request): Promise<AttendanceRecordSummary> {
    return this.attendance.close(auth, recordId, body.reason, body.checkOut, getClientMeta(req));
  }

  // Files a correction request for the signed-in user.
  @Post('corrections')
  @RequirePermissions('attendance.self')
  @ApiOperation({ summary: 'Request an attendance correction' })
  requestCorrection(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateCorrectionDto, @Req() req: Request): Promise<AttendanceCorrectionSummary> {
    return this.attendance.requestCorrection(auth, body, getClientMeta(req));
  }

  // The user's own correction requests.
  @Get('corrections/mine')
  @RequirePermissions('attendance.self')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Own correction requests' })
  myCorrections(@CurrentBusinessUser() auth: BusinessAuthContext): Promise<AttendanceCorrectionSummary[]> {
    return this.attendance.myCorrections(auth);
  }

  // Correction requests of the active location.
  @Get('corrections')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('attendance.review')
  @ApiOperation({ summary: 'Correction requests to review' })
  corrections(@CurrentBusinessUser() auth: BusinessAuthContext, @Query() query: CorrectionQueueQueryDto): Promise<AttendanceCorrectionSummary[]> {
    return this.attendance.correctionQueue(auth, query.status);
  }

  // Approves or rejects a correction request.
  @Post('corrections/:correctionId/review')
  @HttpCode(200)
  @RequirePermissions('attendance.review')
  @ApiOperation({ summary: 'Decide a correction request' })
  review(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('correctionId', ParseUUIDPipe) correctionId: string, @Body() body: ReviewCorrectionDto, @Req() req: Request): Promise<AttendanceCorrectionSummary> {
    return this.attendance.reviewCorrection(auth, correctionId, body, getClientMeta(req));
  }

  // Records an approved leave day.
  @Post('leave-days')
  @RequirePermissions('attendance.review')
  @ApiOperation({ summary: 'Record an approved leave day' })
  addLeaveDay(@CurrentBusinessUser() auth: BusinessAuthContext, @Body() body: CreateLeaveDayDto, @Req() req: Request): Promise<{ id: string }> {
    return this.attendance.addLeaveDay(auth, body, getClientMeta(req));
  }

  // Removes an approved leave day.
  @Delete('leave-days/:leaveDayId')
  @HttpCode(204)
  @RequirePermissions('attendance.review')
  @ApiOperation({ summary: 'Remove an approved leave day' })
  async removeLeaveDay(@CurrentBusinessUser() auth: BusinessAuthContext, @Param('leaveDayId', ParseUUIDPipe) leaveDayId: string, @Req() req: Request): Promise<void> {
    await this.attendance.removeLeaveDay(auth, leaveDayId, getClientMeta(req));
  }
}
