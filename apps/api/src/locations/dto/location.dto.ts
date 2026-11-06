// Request bodies and query parameters for Super Admin location management, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
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
