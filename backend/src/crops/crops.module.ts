import { Module } from '@nestjs/common';
import { FieldsModule } from '../fields/fields.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Crop } from './crop.entity';
import { CropsService } from './crops.service';
import { CropsController } from './crops.controller';

@Module({
  imports: [FieldsModule, TypeOrmModule.forFeature([Crop])],
  providers: [CropsService],
  controllers: [CropsController],
  exports: [CropsService],
})
export class CropsModule {}
