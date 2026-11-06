// Request bodies and filters for rooms and the room status board, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ROOM_BOARD_STATUSES, type RoomBoardStatus } from '@hms/shared';
import { trimOrNull } from '../../businesses/dto/business.dto.js';
import { PaginationQueryDto } from '../../common/http/pagination.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';

// Room operational states a user may set (occupancy and housekeeping are changed by check-in, checkout, and housekeeping).
export const OPERATIONAL_STATUSES = ['ACTIVE', 'OUT_OF_SERVICE', 'INACTIVE'] as const;

// Room numbers are trimmed and upper-cased so "101a" and "101A" count as the same room.
const roomNumberInput = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

// Fields for a new room; capacity and rates default to the room type's values when left out.
export class CreateRoomDto {
  @ApiProperty({ example: '101', description: 'Unique within the location: letters, digits, spaces, dashes, dots, or slashes' })
  @Transform(roomNumberInput)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9 ./-]{0,19}$/, { message: 'roomNumber must be 1-20 letters, digits, spaces, dashes, dots, or slashes' })
  roomNumber!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  floorId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roomTypeId!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxExtraBeds?: number;

  @ApiPropertyOptional({ example: '3500.00' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `standardRate ${MONEY_MESSAGE}` })
  standardRate?: string;

  @ApiPropertyOptional({ example: '800.00' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `extraBedRate ${MONEY_MESSAGE}` })
  extraBedRate?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

// Fields for editing a room, including its operational status.
export class UpdateRoomDto extends PartialType(OmitType(CreateRoomDto, [] as const)) {
  @ApiPropertyOptional({ enum: OPERATIONAL_STATUSES })
  @IsOptional()
  @IsIn(OPERATIONAL_STATUSES)
  operationalStatus?: (typeof OPERATIONAL_STATUSES)[number];
}

// Filters for the room list.
export class ListRoomsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  floorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ enum: OPERATIONAL_STATUSES })
  @IsOptional()
  @IsIn(OPERATIONAL_STATUSES)
  operationalStatus?: (typeof OPERATIONAL_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Room number starts with' })
  @Transform(roomNumberInput)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  search?: string;
}

// Filters for the room status board.
export class RoomBoardQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  floorId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roomTypeId?: string;

  @ApiPropertyOptional({ enum: ROOM_BOARD_STATUSES })
  @IsOptional()
  @IsIn(ROOM_BOARD_STATUSES)
  status?: RoomBoardStatus;
}
