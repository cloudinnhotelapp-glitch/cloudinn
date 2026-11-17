// Request bodies and filters for checkout (Phase 6.6), validated before reaching the service. Only additional charges
// (description and amount), the payments actually received, and a reason for leaving a balance come from the client:
// nights, rates, tax, totals, earlier payments, and balances are always worked out on the server.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';
import { MAX_ADDITIONAL_CHARGES } from '../../billing/billing-rules.js';
import { CheckInPaymentDto, MAX_CHECK_IN_PAYMENTS } from './check-in.dto.js';

// One additional charge added at checkout (taxable like room charges).
export class AdditionalChargeDto {
  @ApiProperty({ maxLength: 200, example: 'Laundry' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value))
  @IsString()
  @MinLength(2, { message: 'Describe each additional charge (at least 2 characters).' })
  @MaxLength(200)
  description!: string;

  @ApiProperty({ example: '350.00' })
  @Transform(moneyInput)
  @Matches(MONEY_PATTERN, { message: `amount ${MONEY_MESSAGE}` })
  amount!: string;
}

// Checking one stay out.
export class CheckOutDto {
  @ApiPropertyOptional({ type: [AdditionalChargeDto], description: 'Extra charges for this room (needs billing.manage)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ADDITIONAL_CHARGES)
  @ValidateNested({ each: true })
  @Type(() => AdditionalChargeDto)
  additionalCharges?: AdditionalChargeDto[];

  @ApiPropertyOptional({ type: [CheckInPaymentDto], description: 'Payments received now (needs payments.record); never more than the balance' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CHECK_IN_PAYMENTS)
  @ValidateNested({ each: true })
  @Type(() => CheckInPaymentDto)
  payments?: CheckInPaymentDto[];

  @ApiPropertyOptional({ minLength: 5, maxLength: 500, description: 'Admins and Managers only: why the guest leaves with an unpaid balance (audited)' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'Enter a reason of at least 5 characters for leaving a balance unpaid.' })
  @MaxLength(500)
  outstandingReason?: string | null;
}

// Search for stays to check out.
export class InHouseQueryDto {
  @ApiPropertyOptional({ maxLength: 100, description: 'Guest name, reservation number, room number, or GRC number' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
