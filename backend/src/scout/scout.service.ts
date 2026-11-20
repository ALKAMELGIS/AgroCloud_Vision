import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScoutTask } from './scout-task.entity';
import { CreateScoutTaskDto, UpdateScoutTaskDto } from './dto/scout-task.dto';
import { FieldsService } from '../fields/fields.service';

@Injectable()
export class ScoutService {
  constructor(
    @InjectRepository(ScoutTask) private readonly repo: Repository<ScoutTask>,
    private readonly fieldsService: FieldsService,
  ) {}

  async create(dto: CreateScoutTaskDto, userId: string, organizationId: string) {
    await this.fieldsService.assertFieldInOrganization(dto.fieldId, organizationId);
    return this.repo.save(this.repo.create({ ...dto, createdByUserId: userId }));
  }

  findAllForFarm(farmId: string, organizationId: string) {
    return this.repo.query(
      `SELECT t.*, to_char(t."dueDate", 'YYYY-MM-DD') AS "dueDate", f.name AS "fieldName"
       FROM scout_tasks t
       JOIN fields f ON f.id::text = t."fieldId"::text
       JOIN farms fa ON fa.id::text = f."farmId"::text
       WHERE fa.id::text = $1 AND fa."organizationId"::text = $2
       ORDER BY (t.status = 'done'), t."dueDate" NULLS LAST, t."createdAt" DESC`,
      [farmId, organizationId],
    );
  }

  private async owned(id: string, organizationId: string) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('المهمة غير موجودة');
    await this.fieldsService.assertFieldInOrganization(task.fieldId, organizationId);
    return task;
  }

  async update(id: string, dto: UpdateScoutTaskDto, organizationId: string) {
    const task = await this.owned(id, organizationId);
    Object.assign(task, dto);
    if (dto.status) task.closedAt = dto.status === 'done' ? new Date() : null;
    return this.repo.save(task);
  }

  async remove(id: string, organizationId: string) {
    await this.owned(id, organizationId);
    await this.repo.delete(id);
    return { id, deleted: true };
  }
}
