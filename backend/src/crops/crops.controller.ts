import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { CropsService } from './crops.service';
import { CreateCropDto, UpdateCropDto } from './dto/create-crop.dto';
import { GrowthStage } from './crop.entity';

@Controller('crops')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CropsController {
  constructor(private readonly cropsService: CropsService) {}

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCropDto) {
    return this.cropsService.create(dto, user.organizationId);
  }

  @Get('by-field/:fieldId')
  findAllForField(@CurrentUser() user: CurrentUserPayload, @Param('fieldId') fieldId: string) {
    return this.cropsService.findAllForField(fieldId, user.organizationId);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST)
  update(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: UpdateCropDto) {
    return this.cropsService.update(id, dto, user.organizationId);
  }

  @Patch(':id/growth-stage')
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST, Role.FIELD_SUPERVISOR)
  updateGrowthStage(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body('growthStage') growthStage: GrowthStage,
  ) {
    return this.cropsService.updateGrowthStage(id, growthStage, user.organizationId);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.AGRONOMIST)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.cropsService.remove(id, user.organizationId);
  }
}
