import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { FieldsService } from './fields.service';
import { BulkCreateFieldsDto, CreateFieldDto, UpdateFieldDto } from './dto/create-field.dto';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFieldDto) {
    return this.fieldsService.create(dto, user.organizationId);
  }

  /** استيراد حدود حقول متعددة دفعة واحدة. */
  @Post('bulk')
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  bulkCreate(@CurrentUser() user: CurrentUserPayload, @Body() dto: BulkCreateFieldsDto) {
    return this.fieldsService.bulkCreate(dto, user.organizationId);
  }

  /** كل حدود حقول المزرعة كـ FeatureCollection واحدة (طلب واحد بدل طلب لكل حقل). */
  @Get('by-farm/:farmId/boundaries.geojson')
  getFarmBoundaries(@CurrentUser() user: CurrentUserPayload, @Param('farmId') farmId: string) {
    return this.fieldsService.getFarmBoundaries(farmId, user.organizationId);
  }

  @Get('by-farm/:farmId')
  findAllForFarm(@CurrentUser() user: CurrentUserPayload, @Param('farmId') farmId: string) {
    return this.fieldsService.findAllForFarm(farmId, user.organizationId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.fieldsService.findOne(id, user.organizationId);
  }

  @Get(':id/boundary.geojson')
  getBoundary(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.fieldsService.getBoundaryAsGeoJson(id, user.organizationId);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  update(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.fieldsService.update(id, dto, user.organizationId);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.MANAGER)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.fieldsService.remove(id, user.organizationId);
  }
}
