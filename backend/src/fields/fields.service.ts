import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Field } from './field.entity';
import { Farm } from '../farms/farm.entity';
import { BulkCreateFieldsDto, CreateFieldDto, UpdateFieldDto } from './dto/create-field.dto';

/** UPDATE … RETURNING through TypeORM's postgres driver yields [rows, count]; INSERT yields rows. */
function firstRow(result: any) {
  return Array.isArray(result?.[0]) ? result[0][0] : result?.[0];
}

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

  /** يتأكد أن الحقل يتبع مزرعة في منظمة المستخدم (عزل المستأجرين). تستخدمه وحدات المحاصيل والأنشطة أيضاً. */
  async assertFieldInOrganization(fieldId: string, organizationId: string) {
    const [row] = await this.fieldsRepo.query(
      `SELECT f.id FROM fields f JOIN farms fa ON fa.id = f."farmId"
       WHERE f.id::text = $1 AND fa."organizationId"::text = $2`,
      [fieldId, organizationId],
    );
    if (!row) throw new NotFoundException('الحقل غير موجود');
  }

  /** تعديل الاسم / الري / المزرعة / الحدود. تغيير الحدود يعيد حساب المساحة. */
  async update(id: string, dto: UpdateFieldDto, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    if (dto.farmId) await this.assertFarmInOrganization(dto.farmId, organizationId);
    if (dto.boundary) {
      const problem = polygonProblem(dto.boundary);
      if (problem) throw new BadRequestException(problem);
    }
    const irrigation = dto.irrigation === undefined ? undefined : dto.irrigation || null;
    try {
      await this.fieldsRepo.query(
        `UPDATE fields SET
           name = COALESCE($2, name),
           "farmId" = COALESCE($3, "farmId"),
           irrigation = CASE WHEN $4::boolean THEN $5 ELSE irrigation END,
           boundary = COALESCE(ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($6)), 4326), boundary)
         WHERE id = $1
         ${RETURNING}`,
        [id, dto.name?.trim() || null, dto.farmId || null, irrigation !== undefined, irrigation ?? null,
         dto.boundary ? JSON.stringify(dto.boundary) : null],
      );
      return firstRow(await this.fieldsRepo.query(
        `UPDATE fields SET "areaHectares" = ST_Area(boundary::geography) / 10000 WHERE id = $1 ${RETURNING}`,
        [id],
      ));
    } catch {
      throw new BadRequestException('تعذّر تعديل الحقل: الشكل غير صالح');
    }
  }

  async remove(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    await this.fieldsRepo.query(`DELETE FROM weather_snapshots WHERE "fieldId"::text = $1`, [id]).catch(() => undefined);
    await this.fieldsRepo.query(`DELETE FROM fields WHERE id = $1`, [id]);
    return { id, deleted: true };
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

  async findAllForFarm(farmId: string, organizationId: string) {
    await this.assertFarmInOrganization(farmId, organizationId);
    return this.fieldsRepo.find({ where: { farmId }, relations: ['crops'] });
  }

  async findOne(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
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
  async getBoundaryAsGeoJson(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    const [row] = await this.fieldsRepo.query(
      `SELECT ST_AsGeoJSON(boundary) AS geojson FROM fields WHERE id = $1`,
      [id],
    );
    return row ? JSON.parse(row.geojson) : null;
  }
}
