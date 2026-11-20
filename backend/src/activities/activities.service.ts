import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from './activity-log.entity';
import { CreateActivityDto } from './dto/create-activity.dto';

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityRepo: Repository<ActivityLog>,
  ) {}

  create(dto: CreateActivityDto, performedByUserId: string) {
    const activity = this.activityRepo.create({ ...dto, performedByUserId });
    return this.activityRepo.save(activity);
  }

  findAllForField(fieldId: string) {
    return this.activityRepo.find({ where: { fieldId }, order: { date: 'DESC' } });
  }
}
