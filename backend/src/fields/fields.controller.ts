import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { FieldsService } from './fields.service';
import { BulkCreateFieldsDto, CreateFieldDto, OverlapChoiceDto, UpdateFieldDto } from './dto/create-field.dto';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('fields')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FieldsController {
  constructor(private readonly fieldsService: FieldsService) {}

  /** Saves a drawn or selected field. Answers 409 with the overlapping fields unless overlap is clip or allow. */
  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFieldDto) {
    return this.fieldsService.create(dto, user.organizationId, user.userId);
  }

  /** استيراد حدود حقول متعددة دفعة واحدة. */
  @Post('bulk')
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  bulkCreate(@CurrentUser() user: CurrentUserPayload, @Body() dto: BulkCreateFieldsDto) {
    return this.fieldsService.bulkCreate(dto, user.organizationId, user.userId);
  }

  /** Checks a shape without saving: area, repairs, overlaps. excludeId skips the field being edited. */
  @Post('check')
  check(@CurrentUser() user: CurrentUserPayload, @Body() body: { boundary: any; excludeId?: string }) {
    return this.fieldsService.check(body?.boundary, user.organizationId, body?.excludeId || null);
  }

  /** Deleted fields of a farm that can still be restored. */
  @Get('archived')
  archived(@CurrentUser() user: CurrentUserPayload, @Query('farmId') farmId: string) {
    return this.fieldsService.archived(farmId, user.organizationId);
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

  /** Everything that happened to the field, newest first; shape changes carry their boundary. */
  @Get(':id/history')
  history(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.fieldsService.history(id, user.organizationId);
  }

  @Post(':id/history/:historyId/restore')
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  restoreBoundary(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Param('historyId') historyId: string, @Body() body: OverlapChoiceDto) {
    return this.fieldsService.restoreBoundary(id, historyId, user.organizationId, user.userId, body?.overlap);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.GIS_ANALYST)
  update(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: UpdateFieldDto) {
    return this.fieldsService.update(id, dto, user.organizationId, user.userId);
  }

  /** Restores a deleted field to its farm. */
  @Post(':id/restore')
  @Roles(Role.OWNER, Role.MANAGER)
  restore(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() body: OverlapChoiceDto) {
    return this.fieldsService.restore(id, user.organizationId, user.userId, body?.overlap);
  }

  /** Moves the field to Recently deleted. ?permanent=true (owner only) removes it and its data for good. */
  @Delete(':id')
  @Roles(Role.OWNER, Role.MANAGER)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Query('permanent') permanent?: string) {
    const forGood = permanent === 'true';
    if (forGood && user.role !== Role.OWNER) throw new ForbiddenException('Only the owner can delete a field permanently');
    return this.fieldsService.remove(id, user.organizationId, user.userId, forGood);
  }
}
