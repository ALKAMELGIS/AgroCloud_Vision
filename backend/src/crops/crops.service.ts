import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Crop } from './crop.entity';
import { CreateCropDto } from './dto/create-crop.dto';

@Injectable()
export class CropsService {
  constructor(
    @InjectRepository(Crop) private readonly cropsRepo: Repository<Crop>,
  ) {}

  create(dto: CreateCropDto) {
    const crop = this.cropsRepo.create(dto);
    return this.cropsRepo.save(crop);
  }

  findAllForField(fieldId: string) {
    return this.cropsRepo.find({ where: { fieldId }, order: { plantingDate: 'DESC' } });
  }

  async updateGrowthStage(id: string, growthStage: Crop['growthStage']) {
    await this.cropsRepo.update(id, { growthStage });
    return this.cropsRepo.findOne({ where: { id } });
  }
}
