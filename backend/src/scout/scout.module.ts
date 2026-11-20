import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldsModule } from '../fields/fields.module';
import { ScoutTask } from './scout-task.entity';
import { ScoutService } from './scout.service';
import { ScoutController } from './scout.controller';

@Module({
  imports: [FieldsModule, TypeOrmModule.forFeature([ScoutTask])],
  providers: [ScoutService],
  controllers: [ScoutController],
})
export class ScoutModule {}
