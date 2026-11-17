// Query of the reports endpoint: an optional range of hotel dates (both ends included). The business and location always
// come from the session.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { DATE_PATTERN } from '../../availability/dto/availability.dto.js';

// The report range; without it the report covers this month up to today.
export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'First day (hotel date); default: the first day of the month of "to"' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-16', description: 'Last day (hotel date), included; default: today at the hotel' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;
}
