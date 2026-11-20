import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class CreateFarmDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  address?: string;
}
