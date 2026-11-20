import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Farm } from './farm.entity';
import { CreateFarmDto } from './dto/create-farm.dto';

/** Deleted (archived) fields stay in the database for restore, but are not part of the farm. */
function liveFields(farm: Farm) {
  if (farm.fields) farm.fields = farm.fields.filter((f) => !f.archivedAt);
  return farm;
}

@Injectable()
export class FarmsService {
  constructor(
    @InjectRepository(Farm) private readonly farmsRepo: Repository<Farm>,
  ) {}

  create(organizationId: string, dto: CreateFarmDto) {
    const farm = this.farmsRepo.create({ ...dto, organizationId });
    return this.farmsRepo.save(farm);
  }

  // عزل متعدد المستأجرين: لا تُعاد أبداً مزارع من مؤسسة أخرى
  async findAllForOrganization(organizationId: string) {
    const farms = await this.farmsRepo.find({
      where: { organizationId },
      relations: ['fields'],
      order: { createdAt: 'DESC' },
    });
    return farms.map(liveFields);
  }

  async findOneForOrganization(id: string, organizationId: string) {
    const farm = await this.farmsRepo.findOne({
      where: { id, organizationId },
      relations: ['fields'],
    });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
    return liveFields(farm);
  }
}
