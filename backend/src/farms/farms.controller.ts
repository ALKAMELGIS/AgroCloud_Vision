import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, Role } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { FarmsService } from './farms.service';
import { CreateFarmDto } from './dto/create-farm.dto';

@Controller('farms')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FarmsController {
  constructor(private readonly farmsService: FarmsService) {}

  @Post()
  @Roles(Role.OWNER, Role.MANAGER)
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFarmDto) {
    return this.farmsService.create(user.organizationId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.farmsService.findAllForOrganization(user.organizationId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.farmsService.findOneForOrganization(id, user.organizationId);
  }
}
