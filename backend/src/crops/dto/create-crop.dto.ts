import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { GrowthStage } from '../crop.entity';

export class CreateCropDto {
  @IsString()
  fieldId: string;

  @IsString()
  cropType: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsDateString()
  plantingDate: string;

  @IsOptional()
  @IsDateString()
  expectedHarvestDate?: string;

  @IsOptional()
  @IsEnum(GrowthStage)
  growthStage?: GrowthStage;
}

export class UpdateCropDto {
  @IsOptional()
  @IsString()
  cropType?: string;

  @IsOptional()
  @IsString()
  variety?: string;

  @IsOptional()
  @IsDateString()
  plantingDate?: string;

  @IsOptional()
  @IsDateString()
  expectedHarvestDate?: string;

  @IsOptional()
  @IsEnum(GrowthStage)
  growthStage?: GrowthStage;
}
