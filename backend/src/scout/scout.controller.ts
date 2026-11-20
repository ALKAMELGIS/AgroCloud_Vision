import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ScoutService } from './scout.service';
import { CreateScoutTaskDto, UpdateScoutTaskDto } from './dto/scout-task.dto';

const WRITERS = [Role.OWNER, Role.MANAGER, Role.GIS_ANALYST, Role.AGRONOMIST, Role.FIELD_SUPERVISOR];

@Controller('scout-tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ScoutController {
  constructor(private readonly scout: ScoutService) {}

  @Post()
  @Roles(...WRITERS)
  create(@CurrentUser() u: CurrentUserPayload, @Body() dto: CreateScoutTaskDto) {
    return this.scout.create(dto, u.userId, u.organizationId);
  }

  @Get('by-farm/:farmId')
  byFarm(@CurrentUser() u: CurrentUserPayload, @Param('farmId') farmId: string) {
    return this.scout.findAllForFarm(farmId, u.organizationId);
  }

  @Patch(':id')
  @Roles(...WRITERS)
  update(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string, @Body() dto: UpdateScoutTaskDto) {
    return this.scout.update(id, dto, u.organizationId);
  }

  @Delete(':id')
  @Roles(...WRITERS)
  remove(@CurrentUser() u: CurrentUserPayload, @Param('id') id: string) {
    return this.scout.remove(id, u.organizationId);
  }
}
