import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Field } from '../fields/field.entity';

export enum GrowthStage {
  PLANTED = 'planted',
  GERMINATION = 'germination',
  VEGETATIVE = 'vegetative',
  FLOWERING = 'flowering',
  FRUITING = 'fruiting',
  MATURITY = 'maturity',
  HARVESTED = 'harvested',
}

@Entity('crops')
export class Crop {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fieldId: string;

  @ManyToOne(() => Field, (field) => field.crops, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldId' })
  field: Field;

  @Column()
  cropType: string; // مثال: قمح، ذرة، قصب سكر

  @Column({ nullable: true })
  variety: string;

  @Column({ type: 'date' })
  plantingDate: string;

  @Column({ type: 'date', nullable: true })
  expectedHarvestDate: string;

  @Column({ type: 'enum', enum: GrowthStage, default: GrowthStage.PLANTED })
  growthStage: GrowthStage;

  @CreateDateColumn()
  createdAt: Date;
}
