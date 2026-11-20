import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Farm } from './farm.entity';
import { CreateFarmDto } from './dto/create-farm.dto';

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
  findAllForOrganization(organizationId: string) {
    return this.farmsRepo.find({
      where: { organizationId },
      relations: ['fields'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOneForOrganization(id: string, organizationId: string) {
    const farm = await this.farmsRepo.findOne({
      where: { id, organizationId },
      relations: ['fields'],
    });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
    return farm;
  }
}
