// Request bodies and query parameters for attendance, validated before reaching the service. There is deliberately no field for whose attendance a punch is, or for which business or location.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ATTENDANCE_ACTIONS, ATTENDANCE_CORRECTION_TYPES, type AttendanceAction, type AttendanceCorrectionType } from '@hms/shared';

// Where the device says it is.
export class PositionDto {
  @ApiProperty({ example: 9.931233 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: 76.267304 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({ example: 20, description: 'Accuracy of the reading, in metres' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  accuracy!: number;
}

// The location check before the camera opens.
export class VerifyLocationDto extends PositionDto {
  @ApiPropertyOptional({ enum: ATTENDANCE_ACTIONS, default: 'CHECK_IN' })
  @IsOptional()
  @IsIn(ATTENDANCE_ACTIONS)
  action?: AttendanceAction;
}

// The form fields sent with a punch photo.
export class PunchDto extends PositionDto {
  @ApiProperty({ description: 'Token from the location check' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  captureToken!: string;
}

// Reason and the actual punch-out time (hotel time) for closing a forgotten check-in; the time is never assumed.
export class CloseAttendanceDto {
  @ApiProperty({ example: '18:00', description: 'When the staff member actually left, in hotel time on the attendance date' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkOut must be a time (HH:mm)' })
  checkOut!: string;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

// Date range of an attendance list.
export class AttendanceRangeDto {
  @ApiPropertyOptional({ example: '2026-11-01' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be a date (YYYY-MM-DD)' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be a date (YYYY-MM-DD)' })
  to?: string;
}

// Filters of the staff attendance list.
export class StaffAttendanceQueryDto extends AttendanceRangeDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// Filters of the management screen; a location is only a request, the server checks the assignment.
export class AttendanceManagementQueryDto extends StaffAttendanceQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}

// Month of the My Attendance calendar.
export class AttendanceMonthQueryDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be a month (YYYY-MM)' })
  month!: string;
}

// Month of the staff attendance report.
export class AttendanceReportQueryDto extends AttendanceMonthQueryDto {}

// A request to correct the signed-in user's own attendance.
export class CreateCorrectionDto {
  @ApiProperty({ example: '2026-11-07' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a date (YYYY-MM-DD)' })
  date!: string;

  @ApiProperty({ enum: ATTENDANCE_CORRECTION_TYPES })
  @IsIn(ATTENDANCE_CORRECTION_TYPES)
  type!: AttendanceCorrectionType;

  @ApiPropertyOptional({ example: '09:05', description: 'Hotel time' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkIn must be a time (HH:mm)' })
  checkIn?: string;

  @ApiPropertyOptional({ example: '18:00', description: 'Hotel time' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'checkOut must be a time (HH:mm)' })
  checkOut?: string;

  @ApiProperty({ minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5, { message: 'Enter a reason of at least 5 characters.' })
  @MaxLength(500)
  reason!: string;
}

// A reviewer's decision on a correction.
export class ReviewCorrectionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// Filter of the correction queue.
export class CorrectionQueueQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] })
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

// An approved leave day for one staff member; the server checks they work at the active location.
export class CreateLeaveDayDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: '2026-11-07' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a date (YYYY-MM-DD)' })
  date!: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
