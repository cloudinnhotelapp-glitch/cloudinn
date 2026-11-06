// Request bodies for creating and editing room types, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trim, trimOrNull } from '../../businesses/dto/business.dto.js';
import { MONEY_MESSAGE, MONEY_PATTERN, moneyInput } from '../../common/http/validation.js';

// Fields for a new room type; the defaults are copied into new rooms of this type.
export class CreateRoomTypeDto {
  @ApiProperty({ example: 'Deluxe Double', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({ example: 2, minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  defaultCapacity!: number;

  @ApiProperty({ example: '3500.00', description: 'Default nightly rate' })
  @Transform(moneyInput)
  @Matches(MONEY_PATTERN, { message: `defaultStandardRate ${MONEY_MESSAGE}` })
  defaultStandardRate!: string;

  @ApiPropertyOptional({ example: '800.00', description: 'Default nightly extra-bed rate', default: '0' })
  @Transform(moneyInput)
  @IsOptional()
  @Matches(MONEY_PATTERN, { message: `defaultExtraBedRate ${MONEY_MESSAGE}` })
  defaultExtraBedRate?: string;
}

// Fields for editing a room type (active/inactive uses the activate/deactivate actions).
export class UpdateRoomTypeDto extends PartialType(CreateRoomTypeDto) {}
