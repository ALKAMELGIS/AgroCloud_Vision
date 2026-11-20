import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { Field } from './field.entity';
import { CreateFieldDto } from './dto/create-field.dto';

@Injectable()
export class FieldsService {
  constructor(
    @InjectRepository(Field) private readonly fieldsRepo: Repository<Field>,
  ) {}

  /**
   * ينشئ حقلاً جديداً ويحسب المساحة بالهكتار مباشرةً من PostGIS
   * باستخدام ST_Area على نسخة مُسقَطة جغرافياً (Geography) للحصول على متر مربع دقيق.
   */
  async create(dto: CreateFieldDto) {
    const geoJson = JSON.stringify(dto.boundary);

    // Built as a plain DeepPartial<Field> (not run through repo.create()) so
    // TypeORM's save() overload resolves to the single-entity signature
    // instead of the array signature, which an `any`-typed argument can
    // otherwise pick ambiguously.
    const fieldData: DeepPartial<Field> = {
      name: dto.name,
      farmId: dto.farmId,
      boundary: (() =>
        `ST_SetSRID(ST_GeomFromGeoJSON('${geoJson}'), 4326)`) as any,
    };

    const saved = await this.fieldsRepo.save(fieldData);

    const [{ area_hectares }] = await this.fieldsRepo.query(
      `SELECT ST_Area(boundary::geography) / 10000 AS area_hectares FROM fields WHERE id = $1`,
      [saved.id],
    );

    saved.areaHectares = parseFloat(area_hectares);
    return this.fieldsRepo.save(saved);
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

  /** يعيد حدود الحقل كـ GeoJSON جاهز للعرض على الخريطة (Leaflet). */
  async getBoundaryAsGeoJson(id: string) {
    const [row] = await this.fieldsRepo.query(
      `SELECT ST_AsGeoJSON(boundary) AS geojson FROM fields WHERE id = $1`,
      [id],
    );
    return row ? JSON.parse(row.geojson) : null;
  }
}
