// Guest profiles for one business: list with search and filters, view, create, and edit. Every query is limited to the
// business from the server-side session, so a guest ID of another business is simply "not found".
// Rules: the email address and the ID document (type + number) are unique within a business; the ID type and number are
// given together or not at all; restricted notes are read and written only by roles with "guests.notes.view".
// Guests are never deleted (history is kept; see docs/architecture.md §8a). Audit entries record which fields changed,
// never the personal values themselves.
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { GuestDetail, GuestSummary, Paginated } from '@hms/shared';
import type { Guest, Prisma } from '../generated/prisma/client.js';
import { AuditLogService } from '../audit-logs/audit-log.service.js';
import { pageArgs, toPage } from '../common/http/pagination.js';
import type { AuditActor } from '../common/tenancy/property-scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateGuestDto, ListGuestsQueryDto, UpdateGuestDto } from './dto/guest.dto.js';

// Who is asking: the business and active location from the session, and whether they may see restricted notes.
export interface GuestAccess {
  businessId: string;
  locationId: string;
  canSeeNotes: boolean;
}

// Counts loaded with every guest (deleted ID files are not counted).
const WITH_COUNTS = { _count: { select: { reservations: true, documents: { where: { deletedAt: null } } } } } as const;

// A guest row with its counts.
export type GuestWithCounts = Guest & { _count: { reservations: number; documents: number } };

// Editable fields, in the order they are reported in audit entries.
const FIELDS = [
  'fullName',
  'email',
  'phone',
  'addressLine',
  'city',
  'state',
  'country',
  'postalCode',
  'nationality',
  'dateOfBirth',
  'idDocumentType',
  'idDocumentNumber',
  'notes',
] as const;

// Service holding the guest rules for business users.
@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // Returns one page of the business's guests, newest first (or by name), optionally searched and filtered.
  async list(access: GuestAccess, query: ListGuestsQueryDto): Promise<Paginated<GuestSummary>> {
    const search = query.search?.trim();
    const where: Prisma.GuestWhereInput = {
      businessId: access.businessId,
      ...(query.idDocumentType ? { idDocumentType: query.idDocumentType } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { idDocumentNumber: { contains: search.toUpperCase() } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.GuestOrderByWithRelationInput[] =
      query.sort === 'name' ? [{ fullName: 'asc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }, { fullName: 'asc' }];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.guest.findMany({ where, include: WITH_COUNTS, orderBy, ...pageArgs(query) }),
      this.prisma.guest.count({ where }),
    ]);
    return toPage(rows.map(toSummary), total, query);
  }

  // Returns one guest of the business, or 404.
  async get(access: GuestAccess, id: string): Promise<GuestDetail> {
    return toDetail(await this.findOrThrow(access, id), access.canSeeNotes);
  }

  // Creates a guest after checking the ID pair, duplicates, and the notes permission.
  async create(access: GuestAccess, dto: CreateGuestDto, actor: AuditActor): Promise<GuestDetail> {
    const guest = await this.prisma.$transaction((tx) => this.createWithin(tx, access, dto, actor));
    return toDetail(guest, access.canSeeNotes);
  }

  // Creates a guest inside the caller's transaction (used by "new guest" in the reservation form, so the guest and the
  // reservation are saved together or not at all). Same rules and audit entry as create().
  async createWithin(tx: Prisma.TransactionClient, access: GuestAccess, dto: CreateGuestDto, actor: AuditActor): Promise<GuestWithCounts> {
    assertNotesAllowed(access, dto);
    const values = toData(dto);
    assertIdPair(values.idDocumentType ?? null, values.idDocumentNumber ?? null);
    await assertNoDuplicate(tx, access.businessId, values.email ?? null, values.idDocumentType ?? null, values.idDocumentNumber ?? null);
    const created = await tx.guest.create({ data: { ...values, fullName: dto.fullName, businessId: access.businessId }, include: WITH_COUNTS });
    await this.audit.record(
      {
        ...actor,
        businessId: access.businessId,
        locationId: access.locationId,
        action: 'guest.created',
        entityType: 'Guest',
        entityId: created.id,
        metadata: { providedFields: FIELDS.filter((key) => created[key] !== null) },
      },
      tx,
    );
    return created;
  }

  // Edits a guest; only the fields sent change. Reports which fields changed in the audit log (not their values).
  async update(access: GuestAccess, id: string, dto: UpdateGuestDto, actor: AuditActor): Promise<GuestDetail> {
    if (dto.fullName === null) throw new BadRequestException(['fullName must not be empty']);
    assertNotesAllowed(access, dto);
    const existing = await this.findOrThrow(access, id);
    const values = toData(dto);
    const next = { ...existing, ...values };
    assertIdPair(next.idDocumentType, next.idDocumentNumber);
    const changed = FIELDS.filter((key) => key in values && !sameValue(existing[key], values[key]));
    if (changed.length === 0) return toDetail(existing, access.canSeeNotes);

    const guest = await this.prisma.$transaction(async (tx) => {
      const emailChanged = changed.includes('email');
      const idChanged = changed.includes('idDocumentType') || changed.includes('idDocumentNumber');
      if (emailChanged || idChanged) {
        await assertNoDuplicate(
          tx,
          access.businessId,
          emailChanged ? next.email : null,
          idChanged ? next.idDocumentType : null,
          idChanged ? next.idDocumentNumber : null,
          id,
        );
      }
      const updated = await tx.guest.update({ where: { id }, data: values, include: WITH_COUNTS });
      await this.audit.record(
        {
          ...actor,
          businessId: access.businessId,
          locationId: access.locationId,
          action: 'guest.updated',
          entityType: 'Guest',
          entityId: id,
          metadata: { changedFields: changed },
        },
        tx,
      );
      return updated;
    });
    return toDetail(guest, access.canSeeNotes);
  }

  // Loads a guest of the caller's business with its counts, or answers 404 (also for other businesses' guests).
  private async findOrThrow(access: GuestAccess, id: string): Promise<GuestWithCounts> {
    const guest = await this.prisma.guest.findFirst({ where: { id, businessId: access.businessId }, include: WITH_COUNTS });
    if (!guest) throw new NotFoundException('Guest not found.');
    return guest;
  }
}

// Refuses notes in a request from a role that may not read restricted notes.
function assertNotesAllowed(access: GuestAccess, dto: CreateGuestDto | UpdateGuestDto): void {
  if (dto.notes !== undefined && !access.canSeeNotes) {
    throw new ForbiddenException('You do not have permission to add or change restricted guest notes.');
  }
}

// The ID type and number must be recorded together, or both left empty.
function assertIdPair(type: string | null, number: string | null): void {
  if ((type === null) !== (number === null)) {
    throw new BadRequestException(['Enter both the ID type and the ID number, or leave both empty.']);
  }
}

// Refuses an email or ID document already used by another guest of the same business (the guest's name is given so
// staff can find the existing profile instead of creating a second one).
async function assertNoDuplicate(
  tx: Prisma.TransactionClient,
  businessId: string,
  email: string | null,
  idType: Guest['idDocumentType'],
  idNumber: string | null,
  excludeId?: string,
): Promise<void> {
  const notSelf = excludeId ? { NOT: { id: excludeId } } : {};
  if (email) {
    const match = await tx.guest.findFirst({ where: { businessId, email: { equals: email, mode: 'insensitive' }, ...notSelf }, select: { fullName: true } });
    if (match) throw new ConflictException(`A guest with this email address already exists: ${match.fullName}.`);
  }
  if (idType && idNumber) {
    const match = await tx.guest.findFirst({ where: { businessId, idDocumentType: idType, idDocumentNumber: idNumber, ...notSelf }, select: { fullName: true } });
    if (match) throw new ConflictException(`A guest with this ID document already exists: ${match.fullName}.`);
  }
}

// Converts validated request fields into database values (only the fields that were sent).
function toData(dto: CreateGuestDto | UpdateGuestDto): Partial<Pick<Guest, (typeof FIELDS)[number]>> {
  const data: Record<string, unknown> = {};
  for (const key of FIELDS) {
    const value = dto[key];
    if (value === undefined) continue;
    data[key] = key === 'dateOfBirth' && typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  }
  return data as Partial<Pick<Guest, (typeof FIELDS)[number]>>;
}

// True when a stored value equals a new value (dates compared by day).
function sameValue(current: unknown, next: unknown): boolean {
  if (current instanceof Date || next instanceof Date) {
    const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);
    return day(current) === day(next);
  }
  return (current ?? null) === (next ?? null);
}

// Shows only the last 4 characters of an ID number, for lists.
export function maskIdNumber(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[^A-Z0-9]/gi, '');
  return `•••• ${compact.slice(-4)}`;
}

// Converts a guest row into the list response.
function toSummary(guest: GuestWithCounts): GuestSummary {
  return {
    id: guest.id,
    fullName: guest.fullName,
    email: guest.email,
    phone: guest.phone,
    city: guest.city,
    country: guest.country,
    nationality: guest.nationality,
    idDocumentType: guest.idDocumentType,
    idDocumentNumberMasked: maskIdNumber(guest.idDocumentNumber),
    reservationCount: guest._count.reservations,
    createdAt: guest.createdAt.toISOString(),
  };
}

// Converts a guest row into the detail response; notes are left out for roles that may not read them.
function toDetail(guest: GuestWithCounts, canSeeNotes: boolean): GuestDetail {
  const { idDocumentNumberMasked: _masked, ...summary } = toSummary(guest);
  return {
    ...summary,
    addressLine: guest.addressLine,
    state: guest.state,
    postalCode: guest.postalCode,
    dateOfBirth: guest.dateOfBirth ? guest.dateOfBirth.toISOString().slice(0, 10) : null,
    idDocumentNumber: guest.idDocumentNumber,
    notesVisible: canSeeNotes,
    notes: canSeeNotes ? guest.notes : null,
    documentCount: guest._count.documents,
    updatedAt: guest.updatedAt.toISOString(),
  };
}
