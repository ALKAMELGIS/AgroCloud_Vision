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

export enum ActivityType {
  TILLAGE = 'tillage',
  PLANTING = 'planting',
  FERTILIZATION = 'fertilization',
  IRRIGATION = 'irrigation',
  SPRAYING = 'spraying',
  PRUNING = 'pruning',
  HARVEST = 'harvest',
  SCOUTING_VISIT = 'scouting_visit',
  OTHER = 'other',
}

@Entity('activity_logs')
export class ActivityLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fieldId: string;

  @ManyToOne(() => Field, (field) => field.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldId' })
  field: Field;

  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  /** المادة المستخدمة: سماد، مبيد، صنف بذور... */
  @Column({ type: 'varchar', length: 120, nullable: true })
  product: string | null;

  @Column({ type: 'double precision', nullable: true })
  rate: number | null;

  /** وحدة المعدل: kg/ha, L/ha, seeds/ha, mm ... */
  @Column({ type: 'varchar', length: 16, nullable: true })
  unit: string | null;

  @Column({ nullable: true })
  performedByUserId: string;

  @CreateDateColumn()
  createdAt: Date;
}
