// Request bodies and query parameters for Super Admin management of business users, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { BUSINESS_ROLES, type BusinessRole } from '@hms/shared';
import { trim, trimOrNull } from '../../businesses/dto/business.dto.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../auth/password/password-policy.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';

// Normalizes an email to trimmed lower case (accounts are stored in lowercase).
const lowerEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// Fields for creating a business user; the server generates a temporary password and the role can never change later.
export class CreateBusinessUserDto {
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ maxLength: 254 })
  @Transform(lowerEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ enum: BUSINESS_ROLES })
  @IsIn(BUSINESS_ROLES)
  role!: BusinessRole;

  // Initial password chosen by the Super Admin; the strength rules (password policy) are checked in the service.
  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ type: [String], description: 'Locations of the same business the user may work in' })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  locationIds!: string[];
}

// Fields a Super Admin may edit on a business user (role and business are fixed).
export class UpdateBusinessUserDto {
  @ApiPropertyOptional({ maxLength: 120 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 254 })
  @Transform(lowerEmail)
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

// The complete new list of locations a user is assigned to (replaces the old list).
export class SetUserLocationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  locationIds!: string[];
}

// Filters for the user list of one business.
export class ListBusinessUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or email' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string | null;

  @ApiPropertyOptional({ enum: BUSINESS_ROLES })
  @IsOptional()
  @IsIn(BUSINESS_ROLES)
  role?: BusinessRole;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

// Filters for the Super Admin's list of business users across all businesses (optionally narrowed to one business).
export class ListAllBusinessUsersQueryDto extends ListBusinessUsersQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  businessId?: string;
}
