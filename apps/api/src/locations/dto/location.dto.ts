// Request bodies and query parameters for Super Admin location management, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsUrl, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { trim, trimOrNull } from '../../businesses/dto/business.dto.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';

// Checks that a value is a real IANA time zone name such as "Asia/Kolkata".
// Uses Intl.DateTimeFormat rather than Intl.supportedValuesOf, because the latter lists only canonical names
// (for example "Asia/Calcutta") and would wrongly reject valid aliases such as "Asia/Kolkata".
@ValidatorConstraint({ name: 'isTimeZone' })
export class IsTimeZoneConstraint implements ValidatorConstraintInterface {
  // Returns true for time zone names (including aliases) that the runtime recognizes.
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  // Message shown when the time zone is unknown.
  defaultMessage(): string {
    return 'timezone must be a valid IANA time zone, for example "Asia/Kolkata"';
  }
}

// Turns a coordinate into trimmed text, and an empty value into null.
const coordinateInput = ({ value }: { value: unknown }) => {
  if (value === '' || value === null) return null;
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() || null : value;
};

// Turns a whole number sent as text into a number, and an empty value into null.
const wholeNumberInput = ({ value }: { value: unknown }) => (value === '' || value === null ? null : typeof value === 'string' ? Number(value) : value);

// Turns text into upper case after trimming (used for codes).
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

// Fields for creating a location under a business.
export class CreateLocationDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ description: 'Short code used in printed numbers, 2-12 letters, digits, or dashes', example: 'MUM1' })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9-]{2,12}$/, { message: 'code must be 2-12 letters, digits, or dashes' })
  code!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @ApiProperty({ example: 'Asia/Kolkata' })
  @Transform(trim)
  @Validate(IsTimeZoneConstraint)
  timezone!: string;

  @ApiProperty({ example: 'INR' })
  @Transform(upper)
  @Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter ISO 4217 code such as INR' })
  currencyCode!: string;

  @ApiProperty({ example: '12.00', description: 'Tax percentage from 0 to 100 with up to 2 decimals' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value))
  @Matches(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, { message: 'taxRatePercent must be a number from 0 to 100 with up to 2 decimals' })
  taxRatePercent!: string;

  @ApiPropertyOptional({ example: '14:00', description: 'Standard check-in time (HH:mm, hotel time); default 14:00' })
  @Transform(trim)
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'standardCheckInTime must be a time (HH:mm)' })
  standardCheckInTime?: string;

  @ApiPropertyOptional({ example: '11:00', description: 'Standard check-out time (HH:mm, hotel time); default 11:00' })
  @Transform(trim)
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'standardCheckOutTime must be a time (HH:mm)' })
  standardCheckOutTime?: string;

  @ApiPropertyOptional({ default: false, description: 'Require at least one uploaded ID document before check-in' })
  @IsOptional()
  @IsBoolean()
  requireIdDocumentUpload?: boolean;

  @ApiPropertyOptional({ maxLength: 500, example: 'https://example.com/feedback', description: 'Link to the guest feedback form (https), used in WhatsApp feedback messages; empty or null clears it' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'guestFeedbackUrl must be an https link' })
  @MaxLength(500)
  guestFeedbackUrl?: string | null;

  @ApiPropertyOptional({ example: '9.931233', description: 'Latitude of the attendance area (set together with longitude and radius); empty or null clears it' })
  @Transform(coordinateInput)
  @IsOptional()
  @Matches(/^-?(90(\.0{1,6})?|[1-8]?\d(\.\d{1,6})?)$/, { message: 'attendanceLatitude must be a latitude from -90 to 90 with up to 6 decimals' })
  attendanceLatitude?: string | null;

  @ApiPropertyOptional({ example: '76.267304', description: 'Longitude of the attendance area' })
  @Transform(coordinateInput)
  @IsOptional()
  @Matches(/^-?(180(\.0{1,6})?|(1[0-7]\d|[1-9]?\d)(\.\d{1,6})?)$/, { message: 'attendanceLongitude must be a longitude from -180 to 180 with up to 6 decimals' })
  attendanceLongitude?: string | null;

  @ApiPropertyOptional({ example: 100, description: 'Allowed distance from the centre, in metres (10 to 5000)' })
  @Transform(({ value }: { value: unknown }) => (value === '' || value === null ? null : typeof value === 'string' ? Number(value) : value))
  @IsOptional()
  @IsInt({ message: 'attendanceRadiusMeters must be a whole number of metres' })
  @Min(10, { message: 'attendanceRadiusMeters must be at least 10 metres' })
  @Max(5000, { message: 'attendanceRadiusMeters must be at most 5000 metres' })
  attendanceRadiusMeters?: number | null;

  @ApiPropertyOptional({ default: true, description: 'Whether staff can punch in and out at this location' })
  @IsOptional()
  @IsBoolean()
  attendanceEnabled?: boolean;

  @ApiPropertyOptional({ example: '09:00', description: 'Expected start of work (HH:mm, hotel time); empty turns late tracking off' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'attendanceShiftStart must be a time (HH:mm)' })
  attendanceShiftStart?: string | null;

  @ApiPropertyOptional({ example: 10, description: 'Minutes after the shift start that still count as on time' })
  @Transform(wholeNumberInput)
  @IsOptional()
  @IsInt({ message: 'attendanceLateGraceMinutes must be a whole number' })
  @Min(0, { message: 'attendanceLateGraceMinutes must be from 0 to 240' })
  @Max(240, { message: 'attendanceLateGraceMinutes must be from 0 to 240' })
  attendanceLateGraceMinutes?: number;

  @ApiPropertyOptional({ example: '08:00', description: 'Earliest allowed punch-in (HH:mm); set together with the latest' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'attendanceCheckInFrom must be a time (HH:mm)' })
  attendanceCheckInFrom?: string | null;

  @ApiPropertyOptional({ example: '11:00', description: 'Latest allowed punch-in (HH:mm)' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'attendanceCheckInUntil must be a time (HH:mm)' })
  attendanceCheckInUntil?: string | null;

  @ApiPropertyOptional({ enum: ['INSIDE_AREA', 'ANY_LOCATION'] })
  @IsOptional()
  @IsIn(['INSIDE_AREA', 'ANY_LOCATION'])
  attendanceCheckOutPolicy?: 'INSIDE_AREA' | 'ANY_LOCATION';

  @ApiPropertyOptional({ example: 365, description: 'Days to keep attendance photos; empty keeps them' })
  @Transform(wholeNumberInput)
  @IsOptional()
  @IsInt({ message: 'attendancePhotoRetentionDays must be a whole number of days' })
  @Min(1, { message: 'attendancePhotoRetentionDays must be at least 1' })
  @Max(3650, { message: 'attendancePhotoRetentionDays must be at most 3650' })
  attendancePhotoRetentionDays?: number | null;
}

// Fields for editing a location; status changes use the activate/deactivate actions.
export class UpdateLocationDto extends PartialType(CreateLocationDto) {}

// Filters for the location list of one business.
export class ListLocationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

// Filters for the Super Admin's list of locations across all businesses (optionally narrowed to one business).
export class ListAllLocationsQueryDto extends ListLocationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ description: 'Matches location name or code' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string | null;
}
