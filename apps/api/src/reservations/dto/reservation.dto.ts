// Request bodies and filters for reservations, validated before reaching the service. Rates, taxes, capacity, and
// availability are never taken from the client: only room IDs, extra beds, and (with permission) an agreed rate.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BOOKING_SOURCES, PAYMENT_METHODS, RESERVATION_LIMITS, RESERVATION_STATUSES, type BookingSource, type PaymentMethod, type ReservationStatus } from '@hms/shared';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';
import { CreateGuestDto } from '../../guests/dto/guest.dto.js';

// "YYYY-MM-DD" dates and "HH:mm" times.
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// One room requested for the booking.
export class ReservationRoomInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roomId!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  extraBeds?: number;

  @ApiPropertyOptional({ example: '3200.00', description: 'Agreed nightly rate when it differs from the room’s standard rate (needs billing.rateOverride and a reason)' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `nightlyRate ${MONEY_MESSAGE}` })
  nightlyRate?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rateOverrideReason?: string | null;
}

// An advance taken while booking (leave out when nothing was received).
export class AdvancePaymentDto {
  @ApiProperty({ example: '2000.00' })
  @Transform(moneyInput)
  @Matches(MONEY_PATTERN, { message: `amount ${MONEY_MESSAGE}` })
  amount!: string;

  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @ApiPropertyOptional({ maxLength: 100, description: 'Card slip, UPI, or bank reference' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

// Fields shared by create and edit.
class ReservationFieldsDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'checkInDate must be a date (YYYY-MM-DD)' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-12-03' })
  @Matches(DATE, { message: 'checkOutDate must be a date (YYYY-MM-DD)' })
  checkOutDate!: string;

  @ApiPropertyOptional({ example: '14:00' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(TIME, { message: 'checkInTime must be a time (HH:mm)' })
  checkInTime?: string | null;

  @ApiPropertyOptional({ example: '11:00' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(TIME, { message: 'checkOutTime must be a time (HH:mm)' })
  checkOutTime?: string | null;

  @ApiProperty({ minimum: 1, maximum: RESERVATION_LIMITS.maxAdults })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RESERVATION_LIMITS.maxAdults)
  adults!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: RESERVATION_LIMITS.maxChildren, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(RESERVATION_LIMITS.maxChildren)
  children?: number;

  @ApiProperty({ type: [ReservationRoomInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one room.' })
  @ArrayMaxSize(RESERVATION_LIMITS.maxRooms)
  @ValidateNested({ each: true })
  @Type(() => ReservationRoomInputDto)
  rooms!: ReservationRoomInputDto[];

  @ApiPropertyOptional({ enum: BOOKING_SOURCES })
  @Transform(trimOrNull)
  @IsOptional()
  @IsIn(BOOKING_SOURCES)
  source?: BookingSource | null;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Special requests or notes' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

// New reservation: an existing guest (guestId) or a new one (guest), plus an optional advance payment.
export class CreateReservationDto extends ReservationFieldsDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing guest (or send "guest" to create one)' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ type: CreateGuestDto, description: 'New guest created together with the reservation' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGuestDto)
  guest?: CreateGuestDto;

  @ApiPropertyOptional({ type: AdvancePaymentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdvancePaymentDto)
  advance?: AdvancePaymentDto;
}

// Edit: the full set of stay details (dates, occupancy, rooms) plus an optional guest change.
export class UpdateReservationDto extends ReservationFieldsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  guestId?: string;
}

// Cancellation with a required reason.
export class CancelReservationDto {
  @ApiProperty({ minLength: 5, maxLength: 500 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Enter a cancellation reason of at least 5 characters.' })
  @MaxLength(500)
  reason!: string;
}

// Marking a no-show (the note is optional).
export class NoShowDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

// An advance payment recorded after booking.
export class RecordPaymentDto extends AdvancePaymentDto {}

// Sort orders for the list.
export const RESERVATION_SORTS = ['newest', 'checkInAsc', 'checkInDesc', 'number'] as const;

// Filters for the reservation list.
export class ListReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Reservation number, guest name, or guest phone' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: RESERVATION_STATUSES })
  @Transform(trimOrNull)
  @IsOptional()
  @IsIn(RESERVATION_STATUSES)
  status?: ReservationStatus;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Stays that are in-house on or after this date' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(DATE, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Stays that start on or before this date' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(DATE, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ enum: RESERVATION_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(RESERVATION_SORTS)
  sort?: (typeof RESERVATION_SORTS)[number];
}

// Availability check for a date range.
export class AvailabilityQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE, { message: 'checkInDate must be a date (YYYY-MM-DD)' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-12-03' })
  @Matches(DATE, { message: 'checkOutDate must be a date (YYYY-MM-DD)' })
  checkOutDate!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'When editing: ignore this reservation’s own rooms' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  excludeReservationId?: string;
}
