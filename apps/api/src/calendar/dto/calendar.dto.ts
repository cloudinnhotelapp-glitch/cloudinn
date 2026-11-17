// Query filters for the reservation calendar (Phase 6.7), validated before reaching the service. Only the date range
// and filters come from the client; the business and location always come from the session.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CALENDAR_MAX_DAYS } from '@hms/shared';
import { DATE_PATTERN } from '../../availability/dto/availability.dto.js';
import { trimOrNull } from '../../businesses/dto/business.dto.js';

// Reads "true"/"false" query strings as booleans (anything else is left for the validator to refuse).
const booleanQuery = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// The calendar range and filters.
export class CalendarQueryDto {
  @ApiProperty({ example: '2026-11-02', description: 'First day shown (hotel date)' })
  @Matches(DATE_PATTERN, { message: 'from must be a date (YYYY-MM-DD)' })
  from!: string;

  @ApiProperty({ minimum: 1, maximum: CALENDAR_MAX_DAYS, example: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CALENDAR_MAX_DAYS)
  days!: number;

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

  @ApiPropertyOptional({ maxLength: 100, description: 'Reservation number or guest name' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: false, description: 'Also show cancelled and no-show bookings' })
  @Transform(booleanQuery)
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}
