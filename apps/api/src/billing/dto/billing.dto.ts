// Request bodies and filters for bills (Phase 6.6), validated before reaching the service.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsUUID } from 'class-validator';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { CheckInPaymentDto } from '../../stays/dto/check-in.dto.js';

// A payment received after checkout against a bill's balance (amount, method, optional reference).
export class BillPaymentDto extends CheckInPaymentDto {}

// Which bills to list: those of one reservation or one guest.
export class ListBillsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsUUID()
  guestId?: string;
}
