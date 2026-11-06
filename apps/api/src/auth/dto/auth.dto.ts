// Request bodies for login and password change, validated before they reach any service.
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { BUSINESS_ROLES, type BusinessRole } from '@hms/shared';
import { PASSWORD_MAX_LENGTH } from '../password/password-policy.js';

// Body of the Super Admin login request.
export class SuperAdminLoginDto {
  @ApiProperty({ example: 'superadmin@yourcompany.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

// Body of the business-user login request; the selected role is only compared with the stored role, never trusted.
export class BusinessLoginDto {
  @ApiProperty({ enum: BUSINESS_ROLES })
  @IsIn(BUSINESS_ROLES)
  role!: BusinessRole;

  @ApiProperty({ example: 'reception@yourhotel.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

// Body of a location switch; the ID is only a request, the server checks the user's assignment.
export class SelectLocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId!: string;
}

// Body of a password-change request (the new password is checked against the password policy by the service).
export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ format: 'password', minLength: 12, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
