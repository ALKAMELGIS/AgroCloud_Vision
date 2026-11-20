import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';

const WRITERS = [Role.OWNER, Role.MANAGER, Role.GIS_ANALYST, Role.AGRONOMIST, Role.FIELD_SUPERVISOR];

@Controller('activities')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  @Roles(...WRITERS)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateActivityDto) {
    return this.activitiesService.create(dto, user.userId, user.organizationId);
  }

  @Get('by-field/:fieldId')
  findAllForField(@CurrentUser() user: CurrentUserPayload, @Param('fieldId') fieldId: string) {
    return this.activitiesService.findAllForField(fieldId, user.organizationId);
  }

  @Get('by-farm/:farmId')
  findAllForFarm(
    @CurrentUser() user: CurrentUserPayload,
    @Param('farmId') farmId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.activitiesService.findAllForFarm(farmId, user.organizationId, from, to);
  }

  @Delete(':id')
  @Roles(...WRITERS)
  remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.activitiesService.remove(id, user.organizationId);
  }
}
