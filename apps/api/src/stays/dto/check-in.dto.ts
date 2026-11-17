// Request bodies and filters for check-in (Phase 6.5), validated before reaching the service. Only identifiers, dates,
// guest counts, extra beds, an agreed rate (with permission), travel details, and the payments actually received come
// from the client: room details, rates, taxes, availability, and payment status are always decided on the server.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PAYMENT_METHODS, RESERVATION_LIMITS, type PaymentMethod } from '@hms/shared';
import { DATE_PATTERN, TIME_PATTERN } from '../../availability/dto/availability.dto.js';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';
import { CreateGuestDto } from '../../guests/dto/guest.dto.js';
import { ReservationRoomInputDto } from '../../reservations/dto/reservation.dto.js';

// Most payment entries one check-in may record (for example part cash, part card).
export const MAX_CHECK_IN_PAYMENTS = 5;

// One payment actually received at check-in (recorded only; nothing is processed or verified).
export class CheckInPaymentDto {
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
}

// Details shared by both kinds of check-in: expected departure time, requests, travel details for the GRC, and payments.
class CheckInCommonDto {
  @ApiPropertyOptional({ example: '11:00', description: 'Expected departure time (hotel time)' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'checkOutTime must be a time (HH:mm)' })
  checkOutTime?: string | null;

  @ApiPropertyOptional({ maxLength: 1000, description: 'Special requests (replaces the reservation notes when sent)' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  specialRequests?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  arrivingFrom?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  goingTo?: string | null;

  @ApiPropertyOptional({ maxLength: 120 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  purposeOfVisit?: string | null;

  @ApiPropertyOptional({ type: [CheckInPaymentDto], description: 'Payments received now; leave empty and set noPaymentReceived when nothing was received' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHECK_IN_PAYMENTS)
  @ValidateNested({ each: true })
  @Type(() => CheckInPaymentDto)
  payments?: CheckInPaymentDto[];

  @ApiPropertyOptional({ description: 'Confirms that no payment was received at check-in' })
  @IsOptional()
  @IsBoolean()
  noPaymentReceived?: boolean;

  @ApiPropertyOptional({ minLength: 5, maxLength: 500, description: 'Admins and Managers only: why the guest is checked in without the ID upload the property requires (audited)' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'Enter a reason of at least 5 characters for checking in without the required ID document.' })
  @MaxLength(500)
  idDocumentOverrideReason?: string | null;
}

// Guests and extra beds for one booked room of the reservation.
export class CheckInRoomDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservationRoomId!: string;

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

  @ApiPropertyOptional({ minimum: 0, maximum: 10, description: 'Default: as booked' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  extraBeds?: number;

  @ApiPropertyOptional({ example: '2800.00', description: 'Given rate per night when it differs from the agreed one (needs billing.rateOverride and a reason)' })
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

// Check-in of a confirmed reservation. `rooms` is needed only when the reservation has more than one room.
export class ReservationCheckInDto extends CheckInCommonDto {
  @ApiPropertyOptional({ type: [CheckInRoomDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RESERVATION_LIMITS.maxRooms)
  @ValidateNested({ each: true })
  @Type(() => CheckInRoomDto)
  rooms?: CheckInRoomDto[];
}

// Walk-in check-in: one room from today (hotel date) until the check-out date, for an existing or a new guest.
export class WalkInCheckInDto extends CheckInCommonDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Existing guest (or send "guest" to create one)' })
  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ApiPropertyOptional({ type: CreateGuestDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateGuestDto)
  guest?: CreateGuestDto;

  @ApiProperty({ example: '2026-12-03' })
  @Matches(DATE_PATTERN, { message: 'checkOutDate must be a date (YYYY-MM-DD)' })
  checkOutDate!: string;

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

  @ApiProperty({ type: ReservationRoomInputDto, description: 'The room (from the availability search), extra beds, and an optional agreed rate' })
  @ValidateNested()
  @Type(() => ReservationRoomInputDto)
  room!: ReservationRoomInputDto;
}

// Search for reservations to check in.
export class ArrivalsQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Reservation number, guest name, or guest phone' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// Which reservation's registration cards to print.
export class RegistrationCardsQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservationId!: string;
}
