// Shared pagination: validated page/pageSize query parameters and the matching Prisma skip/take values.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import type { Paginated } from '@hms/shared';

// Largest page a client may request, so one request cannot load a whole table.
export const MAX_PAGE_SIZE = 100;

// Query parameters for any paginated list (page numbers start at 1).
export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: MAX_PAGE_SIZE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = 20;
}

// Converts page/pageSize into Prisma's skip and take.
export function pageArgs(query: PaginationQueryDto): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

// Wraps one page of items with the pagination numbers.
export function toPage<T>(items: T[], total: number, query: PaginationQueryDto): Paginated<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}
