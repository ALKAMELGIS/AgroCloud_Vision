import { IsIn, IsObject, IsString } from 'class-validator';

/**
 * boundary: GeoJSON Polygon قياسي، مثال:
 * { "type": "Polygon", "coordinates": [[[lng, lat], [lng, lat], ...]] }
 */
export class CreateFieldDto {
  @IsString()
  name: string;

  @IsString()
  farmId: string;

  @IsObject()
  boundary: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}
