import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Field } from './field.entity';

export const HISTORY_EVENTS = ['created', 'boundary_edited', 'boundary_restored', 'renamed', 'moved', 'irrigation', 'archived', 'restored'] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

/**
 * Field history: one row per change. Rows that change the shape carry the boundary
 * at that moment, so every earlier boundary can be shown again or restored.
 */
@Entity('field_history')
export class FieldHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fieldId: string;

  @ManyToOne(() => Field, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldId' })
  field: Field;

  @Column({ type: 'varchar', length: 32 })
  event: HistoryEvent;

  @Column({ type: 'geometry', spatialFeatureType: 'Polygon', srid: 4326, nullable: true })
  boundary: any;

  @Column({ type: 'double precision', nullable: true })
  areaHectares: number | null;

  /** e.g. { from, to } for renames, { repaired, clippedHa } for shape changes */
  @Column({ type: 'jsonb', nullable: true })
  detail: Record<string, any> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  userId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
