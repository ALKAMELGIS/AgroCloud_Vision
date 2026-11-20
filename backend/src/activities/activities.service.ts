import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './activity-log.entity';
import { CreateActivityDto } from './dto/create-activity.dto';
import { FieldsService } from '../fields/fields.service';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityRepo: Repository<ActivityLog>,
    private readonly fieldsService: FieldsService,
  ) {}

  async create(dto: CreateActivityDto, performedByUserId: string, organizationId: string) {
    await this.fieldsService.assertFieldInOrganization(dto.fieldId, organizationId);
    const activity = this.activityRepo.create({ ...dto, performedByUserId });
    return this.activityRepo.save(activity);
  }

  async findAllForField(fieldId: string, organizationId: string) {
    await this.fieldsService.assertFieldInOrganization(fieldId, organizationId);
    return this.activityRepo.find({ where: { fieldId }, order: { date: 'DESC', createdAt: 'DESC' } });
  }

  /** سجل أنشطة كل حقول المزرعة (اختيارياً بين تاريخين) — يغذي تقويم Field Activity Log. */
  findAllForFarm(farmId: string, organizationId: string, from?: string, to?: string) {
    return this.activityRepo.query(
      `SELECT a.id, a."fieldId", f.name AS "fieldName", a.type, to_char(a.date, 'YYYY-MM-DD') AS date,
              a.notes, a.product, a.rate, a.unit, a."createdAt"
       FROM activity_logs a
       JOIN fields f ON f.id::text = a."fieldId"::text
       JOIN farms fa ON fa.id::text = f."farmId"::text
       WHERE fa.id::text = $1 AND fa."organizationId"::text = $2
         AND ($3::date IS NULL OR a.date >= $3::date)
         AND ($4::date IS NULL OR a.date <= $4::date)
       ORDER BY a.date DESC, a."createdAt" DESC`,
      [farmId, organizationId, from || null, to || null],
    );
  }

  async remove(id: string, organizationId: string) {
    const activity = await this.activityRepo.findOne({ where: { id } });
    if (!activity) throw new NotFoundException('النشاط غير موجود');
    await this.fieldsService.assertFieldInOrganization(activity.fieldId, organizationId);
    await this.activityRepo.delete(id);
    return { id, deleted: true };
  }
}
