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
 * What to do when a new or edited boundary overlaps fields that are already saved:
 * reject (default, answers 409 with the list), clip (cut the overlapping part away),
 * allow (keep the overlap). Exact duplicates are never saved.
 * Bulk import also accepts skip (leave out overlapping, duplicate and invalid fields).
 */
export const OVERLAP_MODES = ['reject', 'clip', 'allow'] as const;
export const BULK_OVERLAP_MODES = ['reject', 'clip', 'allow', 'skip'] as const;

/**
 * boundary: GeoJSON Polygon قياسي بإحداثيات WGS84، مثال:
 * { "type": "Polygon", "coordinates": [[[lng, lat], [lng, lat], ...]] }
 */
export class CreateFieldDto {
  /** Empty or missing: the server names it "Field N". */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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

  @IsOptional()
  @IsIn(OVERLAP_MODES)
  overlap?: (typeof OVERLAP_MODES)[number];

  /** Duplicate of a saved field (field menu → Duplicate): the same shape is allowed once more, kept as an overlap. */
  @IsOptional()
  @IsString()
  copyOf?: string;
}

export class BulkFieldItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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

  @IsOptional()
  @IsIn(BULK_OVERLAP_MODES)
  overlap?: (typeof BULK_OVERLAP_MODES)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => BulkFieldItemDto)
  fields: BulkFieldItemDto[];
}

export class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  farmId?: string;

  /** '' يمسح نوع الري */
  @IsOptional()
  @IsIn(['', ...IRRIGATION_TYPES])
  irrigation?: string;

  @IsOptional()
  @IsObject()
  boundary?: {
    type: 'Polygon';
    coordinates: number[][][];
  };

  @IsOptional()
  @IsIn(OVERLAP_MODES)
  overlap?: (typeof OVERLAP_MODES)[number];
}

/** Restoring a deleted field or an earlier boundary checks overlaps the same way. */
export class OverlapChoiceDto {
  @IsOptional()
  @IsIn(OVERLAP_MODES)
  overlap?: (typeof OVERLAP_MODES)[number];
}
