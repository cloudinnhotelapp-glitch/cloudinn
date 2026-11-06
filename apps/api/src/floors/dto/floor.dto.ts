// Request bodies for creating and editing floors, validated before reaching the service.
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trim } from '../../businesses/dto/business.dto.js';

// Fields for a new floor.
export class CreateFloorDto {
  @ApiProperty({ example: 'Ground floor', maxLength: 60 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @ApiPropertyOptional({ description: 'Display order (lower first)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10)
  @Max(500)
  sortOrder?: number;
}

// Fields for editing a floor (active/inactive uses the activate/deactivate actions).
export class UpdateFloorDto extends PartialType(CreateFloorDto) {}
