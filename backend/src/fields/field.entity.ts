import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Farm } from '../farms/farm.entity';
import { Crop } from '../crops/crop.entity';
import { ActivityLog } from '../activities/activity-log.entity';

/**
 * Field = الحقل الزراعي. يخزن حدوده الجغرافية كمضلع PostGIS (SRID 4326 = WGS84)
 * ليتوافق مع إحداثيات GPS/GeoJSON القادمة من المتصفح أو تطبيق الموبايل لاحقاً.
 */
@Entity('fields')
export class Field {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @Column()
  farmId: string;

  @ManyToOne(() => Farm, (farm) => farm.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm: Farm;

  /**
   * حدود الحقل كمضلع جغرافي (GeoJSON Polygon) - PostGIS geometry column.
   * يُخزَّن كـ GeoJSON في التطبيق، ويُحوَّل تلقائياً من/إلى PostGIS عبر الخدمة.
   */
  @Column({
    type: 'geometry',
    spatialFeatureType: 'Polygon',
    srid: 4326,
    nullable: true,
  })
  boundary: any;

  @Column({ type: 'double precision', nullable: true })
  areaHectares: number;

  /** نوع الري: pivot | drip | sprinkler | flood | rainfed (اختياري). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  irrigation: string | null;

  @CreateDateColumn()
  createdAt: Date;

  /** Set when the field is deleted from the farm; the row, its history, crops and activities stay so it can be restored. */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @OneToMany(() => Crop, (crop) => crop.field)
  crops: Crop[];

  @OneToMany(() => ActivityLog, (activity) => activity.field)
  activities: ActivityLog[];
}
