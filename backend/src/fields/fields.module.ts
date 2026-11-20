import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Field } from './field.entity';
import { FieldHistory } from './field-history.entity';
import { Farm } from '../farms/farm.entity';
import { FieldsService } from './fields.service';
import { FieldsController } from './fields.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Field, Farm, FieldHistory])],
  providers: [FieldsService],
  controllers: [FieldsController],
  exports: [FieldsService],
})
export class FieldsModule {}
