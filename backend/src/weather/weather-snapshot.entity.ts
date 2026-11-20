import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * تخزين اختياري لنتائج الطقس المجلوبة، لتقليل عدد الطلبات المتكررة لنفس الحقل/اليوم
 * (Caching طبقة بيانات بسيطة).
 */
@Entity('weather_snapshots')
export class WeatherSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  fieldId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'double precision', nullable: true })
  temperatureMaxC: number;

  @Column({ type: 'double precision', nullable: true })
  temperatureMinC: number;

  @Column({ type: 'double precision', nullable: true })
  precipitationMm: number;

  @Column({ type: 'double precision', nullable: true })
  windSpeedMaxKmh: number;

  @Column({ default: 'open-meteo' })
  source: string;

  @CreateDateColumn()
  fetchedAt: Date;
}
