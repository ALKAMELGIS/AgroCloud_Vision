import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { ActivitiesService } from './activities.service';
import { CreateActivityDto } from './dto/create-activity.dto';

@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateActivityDto) {
    return this.activitiesService.create(dto, user.userId);
  }

  @Get('by-field/:fieldId')
  findAllForField(@Param('fieldId') fieldId: string) {
    return this.activitiesService.findAllForField(fieldId);
  }
}
