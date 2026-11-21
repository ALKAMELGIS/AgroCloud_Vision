import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Farm } from '../farms/farm.entity';

export enum SubscriptionPlan {
  TRIAL = 'trial',
  STARTER = 'starter',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
}

/**
 * Organization = المستأجر (Tenant) في منصة AgroOne Vision.
 * كل شركة/مزرعة مشتركة تحصل على Organization مستقلة بيانياً بالكامل.
 */
@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: SubscriptionPlan, default: SubscriptionPlan.TRIAL })
  plan: SubscriptionPlan;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => Farm, (farm) => farm.organization)
  farms: Farm[];
}
