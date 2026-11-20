import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Crop } from './crop.entity';
import { CreateCropDto, UpdateCropDto } from './dto/create-crop.dto';
import { FieldsService } from '../fields/fields.service';

@Injectable()
export class CropsService {
  constructor(
    @InjectRepository(Crop) private readonly cropsRepo: Repository<Crop>,
    private readonly fieldsService: FieldsService,
  ) {}

  private async ownedCrop(id: string, organizationId: string) {
    const crop = await this.cropsRepo.findOne({ where: { id } });
    if (!crop) throw new NotFoundException('المحصول غير موجود');
    await this.fieldsService.assertFieldInOrganization(crop.fieldId, organizationId);
    return crop;
  }

  async create(dto: CreateCropDto, organizationId: string) {
    await this.fieldsService.assertFieldInOrganization(dto.fieldId, organizationId);
    return this.cropsRepo.save(this.cropsRepo.create(dto));
  }

  async findAllForField(fieldId: string, organizationId: string) {
    await this.fieldsService.assertFieldInOrganization(fieldId, organizationId);
    return this.cropsRepo.find({ where: { fieldId }, order: { plantingDate: 'DESC' } });
  }

  async update(id: string, dto: UpdateCropDto, organizationId: string) {
    const crop = await this.ownedCrop(id, organizationId);
    Object.assign(crop, dto);
    return this.cropsRepo.save(crop);
  }

  async updateGrowthStage(id: string, growthStage: Crop['growthStage'], organizationId: string) {
    return this.update(id, { growthStage }, organizationId);
  }

  async remove(id: string, organizationId: string) {
    await this.ownedCrop(id, organizationId);
    await this.cropsRepo.delete(id);
    return { id, deleted: true };
  }
}
