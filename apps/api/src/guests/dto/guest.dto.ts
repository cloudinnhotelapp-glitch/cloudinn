// Request bodies and filters for guests, validated and cleaned up before reaching the service. Text is trimmed, empty
// optional fields become null, emails are lower-cased, and ID numbers are upper-cased so duplicates are found reliably.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { GUEST_DOCUMENT_TYPES, type GuestDocumentType } from '@hms/shared';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';

// Trims, collapses inner spaces, and turns an empty value into null.
const cleanText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned === '' ? null : cleaned;
};

// Like cleanText, then lower-cases (emails).
const cleanLower = (input: { value: unknown }) => {
  const value = cleanText(input);
  return typeof value === 'string' ? value.toLowerCase() : value;
};

// Like cleanText, then upper-cases (ID numbers and postal codes).
const cleanUpper = (input: { value: unknown }) => {
  const value = cleanText(input);
  return typeof value === 'string' ? value.toUpperCase() : value;
};

// Phone numbers: digits with an optional leading "+", spaces, dashes, dots, and brackets (6 to 40 characters).
export const PHONE_PATTERN = /^\+?[0-9][0-9 ().-]{4,38}[0-9]$/;

// ID numbers: letters and digits with optional spaces, dashes, or slashes (3 to 60 characters).
export const ID_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9 /-]{1,58}[A-Z0-9]$/;

// Accepts a real calendar date "YYYY-MM-DD" between 1900-01-01 and today.
@ValidatorConstraint({ name: 'pastDate', async: false })
class PastDateConstraint implements ValidatorConstraintInterface {
  // True for a valid date that is not in the future.
  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
    return value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10);
  }

  // Message for an invalid date of birth.
  defaultMessage(): string {
    return 'dateOfBirth must be a real date (YYYY-MM-DD) that is not in the future';
  }
}

// Fields for creating a guest; only the full name is required. Notes need the restricted-notes permission (checked in the service).
export class CreateGuestDto {
  @ApiProperty({ maxLength: 160 })
  @Transform(cleanText)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @Transform(cleanLower)
  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ maxLength: 40, example: '+91 98765 43210' })
  @Transform(cleanText)
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'phone must contain digits, with an optional leading +, spaces, dashes, dots, or brackets' })
  @MaxLength(40)
  phone?: string | null;

  @ApiPropertyOptional({ maxLength: 300 })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(300)
  addressLine?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string | null;

  @ApiPropertyOptional({ maxLength: 20 })
  @Transform(cleanUpper)
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9 -]{1,18}[A-Z0-9]$/, { message: 'postalCode must be 3-20 letters, digits, spaces, or dashes' })
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nationality?: string | null;

  @ApiPropertyOptional({ example: '1990-04-21', description: 'Date only (YYYY-MM-DD), not in the future' })
  @Transform(trimOrNull)
  @IsOptional()
  @Validate(PastDateConstraint)
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: GUEST_DOCUMENT_TYPES, description: 'Required together with idDocumentNumber' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsIn(GUEST_DOCUMENT_TYPES)
  idDocumentType?: GuestDocumentType | null;

  @ApiPropertyOptional({ maxLength: 60, description: 'Required together with idDocumentType' })
  @Transform(cleanUpper)
  @IsOptional()
  @Matches(ID_NUMBER_PATTERN, { message: 'idDocumentNumber must be 3-60 letters or digits (spaces, dashes, and slashes allowed inside)' })
  idDocumentNumber?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, description: 'Restricted notes (Admin and Manager only)' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

// Fields for editing a guest: any subset; null clears an optional field (the full name cannot be cleared).
export class UpdateGuestDto extends PartialType(CreateGuestDto) {}

// Sort orders for the guest list.
export const GUEST_SORTS = ['newest', 'name'] as const;

// Filters for the guest list.
export class ListGuestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Matches name, email, phone, or ID number' })
  @Transform(cleanText)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: GUEST_DOCUMENT_TYPES })
  @Transform(trimOrNull)
  @IsOptional()
  @IsIn(GUEST_DOCUMENT_TYPES)
  idDocumentType?: GuestDocumentType;

  @ApiPropertyOptional({ enum: GUEST_SORTS, default: 'newest' })
  @IsOptional()
  @IsIn(GUEST_SORTS)
  sort?: (typeof GUEST_SORTS)[number];
}
