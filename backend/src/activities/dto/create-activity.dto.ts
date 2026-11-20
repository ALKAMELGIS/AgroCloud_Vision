import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
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
  notes?: string;
}
