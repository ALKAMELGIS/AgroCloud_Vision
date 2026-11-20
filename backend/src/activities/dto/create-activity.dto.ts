import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ActivityType } from '../activity-log.entity';

export class CreateActivityDto {
  @IsString()
  fieldId: string;

  @IsEnum(ActivityType)
  type: ActivityType;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  product?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;
}
