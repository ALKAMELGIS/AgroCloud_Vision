import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { CropsService } from './crops.service';
import { CreateCropDto } from './dto/create-crop.dto';
import { GrowthStage } from './crop.entity';

@Controller('crops')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CropsController {
  constructor(private readonly cropsService: CropsService) {}

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST)
  create(@Body() dto: CreateCropDto) {
    return this.cropsService.create(dto);
  }

  @Get('by-field/:fieldId')
  findAllForField(@Param('fieldId') fieldId: string) {
    return this.cropsService.findAllForField(fieldId);
  }

  @Patch(':id/growth-stage')
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST, Role.FIELD_SUPERVISOR)
  updateGrowthStage(@Param('id') id: string, @Body('growthStage') growthStage: GrowthStage) {
    return this.cropsService.updateGrowthStage(id, growthStage);
  }
}
