import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { FieldsService } from './fields.service';
import { CreateFieldDto } from './dto/create-field.dto';

@Controller('fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  create(@Body() dto: CreateFieldDto) {
    return this.fieldsService.create(dto);
  }

  @Get('by-farm/:farmId')
  findAllForFarm(@Param('farmId') farmId: string) {
    return this.fieldsService.findAllForFarm(farmId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.fieldsService.findOne(id);
  }

  @Get(':id/boundary.geojson')
  getBoundary(@Param('id') id: string) {
    return this.fieldsService.getBoundaryAsGeoJson(id);
  }
}
