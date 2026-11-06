// Query parameters for the platform audit-log view, validated before reaching the service.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';

// Filters: business, actor type, and an action prefix such as "business." or "auth.login".
export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  businessId?: string;

  @ApiPropertyOptional({ enum: ['SUPER_ADMIN', 'BUSINESS_USER', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'BUSINESS_USER', 'SYSTEM'])
  actorType?: 'SUPER_ADMIN' | 'BUSINESS_USER' | 'SYSTEM';

  @ApiPropertyOptional({ description: 'Action name or prefix, for example "business." or "auth.login"' })
  @Transform(trimOrNull)
  @IsOptional()
  @Matches(/^[a-z_.]{1,80}$/, { message: 'action may only contain lowercase letters, dots, and underscores' })
  action?: string | null;
}
