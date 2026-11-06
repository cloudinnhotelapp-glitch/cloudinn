// Request bodies and query parameters for Super Admin business management, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination.js';

// Trims surrounding spaces from text input and turns an empty string into null (meaning "clear this field").
export const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

// Trims surrounding spaces from required text input.
export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// Fields for creating a business (the business starts ACTIVE).
export class CreateBusinessDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalName?: string | null;

  @ApiPropertyOptional({ maxLength: 254 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  @ApiPropertyOptional({ maxLength: 40 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

// Fields for editing a business; every field is optional and status changes use the suspend/reactivate actions.
export class UpdateBusinessDto extends PartialType(CreateBusinessDto) {}

// Reason required when suspending a business (kept in the record and the audit log).
export class SuspendBusinessDto {
  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// Filters for the business list.
export class ListBusinessesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name, legal name, or contact email' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}
