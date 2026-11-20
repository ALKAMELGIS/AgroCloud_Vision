import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Field } from './field.entity';
import { Farm } from '../farms/farm.entity';
import { BulkCreateFieldsDto, CreateFieldDto } from './dto/create-field.dto';

const RETURNING = `RETURNING id, name, "farmId", irrigation, "areaHectares", "createdAt"`;

/** يتحقق أن الحدود Polygon صالح بإحداثيات WGS84، ويُرجع رسالة خطأ أو null. */
function polygonProblem(boundary: any): string | null {
  if (!boundary || boundary.type !== 'Polygon' || !Array.isArray(boundary.coordinates)) {
    return 'boundary must be a GeoJSON Polygon';
  }
  const rings = boundary.coordinates;
  if (!rings.length) return 'polygon has no rings';
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return 'each ring needs at least 4 positions';
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) return 'invalid position';
      const [lng, lat] = p;
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
        return 'coordinates must be WGS84 longitude/latitude';
      }
    }
  }
  return null;
}

@Injectable()
export class FieldsService {
  constructor(
    @InjectRepository(Field) private readonly fieldsRepo: Repository<Field>,
    @InjectRepository(Farm) private readonly farmsRepo: Repository<Farm>,
  ) {}

  private async assertFarmInOrganization(farmId: string, organizationId: string) {
    const farm = await this.farmsRepo.findOne({ where: { id: farmId, organizationId } });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
  }

  /**
   * ينشئ حقلاً جديداً ويحسب المساحة بالهكتار مباشرةً من PostGIS
   * باستخدام ST_Area على نسخة Geography للحصول على متر مربع دقيق.
   * الهندسة تُمرَّر كمعامل SQL (وليس نصاً مدمجاً) لمنع حقن SQL.
   */
  async create(dto: CreateFieldDto, organizationId: string) {
    const problem = polygonProblem(dto.boundary);
    if (problem) throw new BadRequestException(problem);
    await this.assertFarmInOrganization(dto.farmId, organizationId);

    try {
      const [row] = await this.fieldsRepo.query(
        `INSERT INTO fields (name, "farmId", irrigation, boundary, "areaHectares")
         SELECT $1, $2, $3, g, ST_Area(g::geography) / 10000
         FROM (SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($4)), 4326) AS g) s
         ${RETURNING}`,
        [dto.name.trim(), dto.farmId, dto.irrigation ?? null, JSON.stringify(dto.boundary)],
      );
      return row;
    } catch {
      throw new BadRequestException('تعذّر حفظ حدود الحقل: الشكل غير صالح');
    }
  }

  /**
   * استيراد عدة حقول في استعلام واحد داخل معاملة واحدة:
   * إما أن تُحفظ كلها أو لا يُحفظ شيء.
   */
  async bulkCreate(dto: BulkCreateFieldsDto, organizationId: string) {
    dto.fields.forEach((f, i) => {
      const problem = polygonProblem(f.boundary);
      if (problem) throw new BadRequestException(`Field ${i + 1} (${f.name}): ${problem}`);
    });
    await this.assertFarmInOrganization(dto.farmId, organizationId);

    const payload = JSON.stringify(dto.fields.map((f) => ({ name: f.name.trim(), boundary: f.boundary })));
    try {
      return await this.fieldsRepo.query(
        `INSERT INTO fields (name, "farmId", irrigation, boundary, "areaHectares")
         SELECT item->>'name', $1, $2, g, ST_Area(g::geography) / 10000
         FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS t(item, ord)
         CROSS JOIN LATERAL (
           SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(item->'boundary')), 4326) AS g
         ) s
         ORDER BY ord
         ${RETURNING}`,
        [dto.farmId, dto.irrigation ?? null, payload],
      );
    } catch {
      throw new BadRequestException('تعذّر استيراد الحقول: أحد الأشكال غير صالح');
    }
  }

  findAllForFarm(farmId: string) {
    return this.fieldsRepo.find({ where: { farmId }, relations: ['crops'] });
  }

  async findOne(id: string) {
    const field = await this.fieldsRepo.findOne({
      where: { id },
      relations: ['crops', 'activities', 'farm'],
    });
    if (!field) throw new NotFoundException('الحقل غير موجود');
    return field;
  }

  async getFarmBoundaries(farmId: string, organizationId: string) {
    await this.assertFarmInOrganization(farmId, organizationId);
    const [row] = await this.fieldsRepo.query(
      `SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE(json_agg(json_build_object(
           'type', 'Feature',
           'id', id,
           'properties', json_build_object('id', id, 'name', name, 'areaHectares', "areaHectares", 'irrigation', irrigation),
           'geometry', ST_AsGeoJSON(boundary)::json
         ) ORDER BY "createdAt"), '[]'::json)
       ) AS fc
       FROM fields WHERE "farmId" = $1 AND boundary IS NOT NULL`,
      [farmId],
    );
    return row.fc;
  }

  /** يعيد حدود الحقل كـ GeoJSON جاهز للعرض على الخريطة (Leaflet). */
  async getBoundaryAsGeoJson(id: string) {
    const [row] = await this.fieldsRepo.query(
      `SELECT ST_AsGeoJSON(boundary) AS geojson FROM fields WHERE id = $1`,
      [id],
    );
    return row ? JSON.parse(row.geojson) : null;
  }
}
