// Query filters for the room availability search, validated before reaching the service. Only dates, times, guest
// counts, and filters come from the client: room states, rates, taxes, and availability are always read on the server.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { RESERVATION_LIMITS } from '@hms/shared';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';

// "YYYY-MM-DD" dates and "HH:mm" times (hotel local time).
export const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Reads "true"/"false" query strings as booleans (anything else is left for the validator to refuse).
const booleanQuery = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// Availability search: stay dates and times, optional location (one of the user's own), and the result filters.
export class RoomAvailabilityQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE_PATTERN, { message: 'checkInDate must be a date (YYYY-MM-DD)' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-12-03' })
  @Matches(DATE_PATTERN, { message: 'checkOutDate must be a date (YYYY-MM-DD)' })
  checkOutDate!: string;

  @ApiPropertyOptional({ example: '14:00', description: 'Expected arrival (hotel time); checked against a same-day departure' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'checkInTime must be a time (HH:mm)' })
  checkInTime?: string | null;

  @ApiPropertyOptional({ example: '11:00', description: 'Expected departure (hotel time); checked against a same-day arrival' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'checkOutTime must be a time (HH:mm)' })
  checkOutTime?: string | null;

  @ApiPropertyOptional({ format: 'uuid', description: 'One of the user’s assigned locations (default: the active location)' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  floorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, description: 'Rooms that sleep at least this many without extra beds' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  minCapacity?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: RESERVATION_LIMITS.maxAdults, description: 'Guests for one room: rooms that cannot sleep them (with extra beds) are not available' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RESERVATION_LIMITS.maxAdults)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: RESERVATION_LIMITS.maxChildren })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(RESERVATION_LIMITS.maxChildren)
  children?: number;

  @ApiPropertyOptional({ example: '2000.00', description: 'Lowest nightly rate' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `minRate ${MONEY_MESSAGE}` })
  minRate?: string;

  @ApiPropertyOptional({ example: '5000.00', description: 'Highest nightly rate' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `maxRate ${MONEY_MESSAGE}` })
  maxRate?: string;

  @ApiPropertyOptional({ default: false, description: 'Return only the rooms that can be booked' })
  @Transform(booleanQuery)
  @IsOptional()
  @IsBoolean()
  availableOnly?: boolean;

  @ApiPropertyOptional({ default: false, description: 'For a check-in now: rooms with a guest still in them are not available, even when that guest is due to leave today' })
  @Transform(booleanQuery)
  @IsOptional()
  @IsBoolean()
  vacantNow?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'When editing: ignore this reservation’s own rooms' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  excludeReservationId?: string;
}
