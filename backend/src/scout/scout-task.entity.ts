import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const SCOUT_ISSUES = ['pests', 'disease', 'weeds', 'water_stress', 'nutrient', 'other'] as const;
export const SCOUT_PRIORITIES = ['low', 'medium', 'high'] as const;
export const SCOUT_STATUSES = ['open', 'in_progress', 'done'] as const;

/** مهمة استكشاف ميداني: نقطة على الخريطة مع نوع المشكلة والأولوية والحالة. */
@Entity('scout_tasks')
export class ScoutTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  fieldId: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 20, default: 'other' })
  issue: string;

  @Column({ type: 'varchar', length: 10, default: 'medium' })
  priority: string;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'double precision' })
  lat: number;

  @Column({ type: 'double precision' })
  lng: number;

  @Column({ type: 'varchar', length: 120, nullable: true })
  assignee: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}
