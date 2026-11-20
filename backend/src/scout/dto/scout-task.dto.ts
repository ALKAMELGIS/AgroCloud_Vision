import { IsDateString, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { SCOUT_ISSUES, SCOUT_PRIORITIES, SCOUT_STATUSES } from '../scout-task.entity';

export class CreateScoutTaskDto {
  @IsString() fieldId: string;
  @IsString() @MaxLength(160) title: string;
  @IsOptional() @IsIn(SCOUT_ISSUES) issue?: string;
  @IsOptional() @IsIn(SCOUT_PRIORITIES) priority?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsString() @MaxLength(120) assignee?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateScoutTaskDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsIn(SCOUT_ISSUES) issue?: string;
  @IsOptional() @IsIn(SCOUT_PRIORITIES) priority?: string;
  @IsOptional() @IsIn(SCOUT_STATUSES) status?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @MaxLength(120) assignee?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}
