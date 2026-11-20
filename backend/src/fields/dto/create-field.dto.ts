import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const IRRIGATION_TYPES = ['pivot', 'drip', 'sprinkler', 'flood', 'rainfed'] as const;

/**
 * boundary: GeoJSON Polygon قياسي بإحداثيات WGS84، مثال:
 * { "type": "Polygon", "coordinates": [[[lng, lat], [lng, lat], ...]] }
 */
export class CreateFieldDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  farmId: string;

  @IsObject()
  boundary: {
    type: 'Polygon';
    coordinates: number[][][];
  };

  @IsOptional()
  @IsIn(IRRIGATION_TYPES)
  irrigation?: string;
}

export class BulkFieldItemDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsObject()
  boundary: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

/** استيراد عدة حقول دفعة واحدة (من GeoJSON / KML / Shapefile / GDB / GPKG). */
export class BulkCreateFieldsDto {
  @IsString()
  farmId: string;

  @IsOptional()
  @IsIn(IRRIGATION_TYPES)
  irrigation?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BulkFieldItemDto)
  fields: BulkFieldItemDto[];
}
