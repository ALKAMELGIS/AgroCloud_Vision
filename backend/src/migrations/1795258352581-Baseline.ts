import { MigrationInterface, QueryRunner } from "typeorm";

/** Schema as of the AgroOne rename (2026-11-21). Later changes go in new migrations. */
export class Baseline1795258352581 implements MigrationInterface {
    name = 'Baseline1795258352581'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Databases created before migrations existed were built by TypeORM
        // synchronize and already hold this schema: record the baseline only.
        const [{ exists }] = await queryRunner.query(`SELECT to_regclass('public.organizations') IS NOT NULL AS "exists"`);
        if (exists) return;
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);
        await queryRunner.query(`CREATE TABLE "weather_snapshots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fieldId" character varying NOT NULL, "date" date NOT NULL, "temperatureMaxC" double precision, "temperatureMinC" double precision, "precipitationMm" double precision, "windSpeedMaxKmh" double precision, "source" character varying NOT NULL DEFAULT 'open-meteo', "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bdd1d3db880486a0ecb697ecf7b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_80bf5a029c26afc0f68027793e" ON "weather_snapshots" ("fieldId") `);
        await queryRunner.query(`CREATE TABLE "scout_tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fieldId" uuid NOT NULL, "title" character varying(160) NOT NULL, "issue" character varying(20) NOT NULL DEFAULT 'other', "priority" character varying(10) NOT NULL DEFAULT 'medium', "status" character varying(12) NOT NULL DEFAULT 'open', "dueDate" date, "lat" double precision NOT NULL, "lng" double precision NOT NULL, "assignee" character varying(120), "notes" text, "createdByUserId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "closedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_56105edea6662995c48cde682e5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_963f754ca57419dac07d497e2f" ON "scout_tasks" ("fieldId") `);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('owner', 'manager', 'gis_analyst', 'agronomist', 'field_supervisor', 'viewer')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "passwordHash" character varying NOT NULL, "fullName" character varying NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'viewer', "organizationId" uuid NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users" ("email") `);
        await queryRunner.query(`CREATE TYPE "public"."crops_growthstage_enum" AS ENUM('planted', 'germination', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested')`);
        await queryRunner.query(`CREATE TABLE "crops" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fieldId" uuid NOT NULL, "cropType" character varying NOT NULL, "variety" character varying, "plantingDate" date NOT NULL, "expectedHarvestDate" date, "growthStage" "public"."crops_growthstage_enum" NOT NULL DEFAULT 'planted', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_098dbeb7c803dc7c08a7f02b805" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_25fdc9bbc32d36d7065b0a5f03" ON "crops" ("fieldId") `);
        await queryRunner.query(`CREATE TYPE "public"."activity_logs_type_enum" AS ENUM('tillage', 'planting', 'fertilization', 'irrigation', 'spraying', 'pruning', 'harvest', 'scouting_visit', 'other')`);
        await queryRunner.query(`CREATE TABLE "activity_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fieldId" uuid NOT NULL, "type" "public"."activity_logs_type_enum" NOT NULL, "date" date NOT NULL, "notes" text, "product" character varying(120), "rate" double precision, "unit" character varying(16), "performedByUserId" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f25287b6140c5ba18d38776a796" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_aa1910cacfdec3615476cf205b" ON "activity_logs" ("fieldId") `);
        await queryRunner.query(`CREATE TABLE "fields" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "farmId" uuid NOT NULL, "boundary" geometry(Polygon,4326), "areaHectares" double precision, "irrigation" character varying(32), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "archivedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ee7a215c6cd77a59e2cb3b59d41" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_405630ac29fc182b50f882aa66" ON "fields" ("farmId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bf7c9f84f072f0f0c035b7ec39" ON "fields" ("archivedAt") `);
        await queryRunner.query(`CREATE TABLE "farms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "organizationId" uuid NOT NULL, "latitude" double precision, "longitude" double precision, "address" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_39aff9c35006b14025bba5a43d9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_51aa469f258ad561565978d48a" ON "farms" ("organizationId") `);
        await queryRunner.query(`CREATE TYPE "public"."organizations_plan_enum" AS ENUM('trial', 'starter', 'professional', 'enterprise')`);
        await queryRunner.query(`CREATE TABLE "organizations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "plan" "public"."organizations_plan_enum" NOT NULL DEFAULT 'trial', "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6b031fcd0863e3f6b44230163f9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "field_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fieldId" uuid NOT NULL, "event" character varying(32) NOT NULL, "boundary" geometry(Polygon,4326), "areaHectares" double precision, "detail" jsonb, "userId" character varying(64), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e876c86d137473d2db86b10ee76" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_53fabd3505332b2b13c0ebaa7e" ON "field_history" ("fieldId") `);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_f3d6aea8fcca58182b2e80ce979" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crops" ADD CONSTRAINT "FK_25fdc9bbc32d36d7065b0a5f039" FOREIGN KEY ("fieldId") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activity_logs" ADD CONSTRAINT "FK_aa1910cacfdec3615476cf205bd" FOREIGN KEY ("fieldId") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "fields" ADD CONSTRAINT "FK_405630ac29fc182b50f882aa664" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "farms" ADD CONSTRAINT "FK_51aa469f258ad561565978d48ae" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "field_history" ADD CONSTRAINT "FK_53fabd3505332b2b13c0ebaa7ec" FOREIGN KEY ("fieldId") REFERENCES "fields"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "field_history" DROP CONSTRAINT "FK_53fabd3505332b2b13c0ebaa7ec"`);
        await queryRunner.query(`ALTER TABLE "farms" DROP CONSTRAINT "FK_51aa469f258ad561565978d48ae"`);
        await queryRunner.query(`ALTER TABLE "fields" DROP CONSTRAINT "FK_405630ac29fc182b50f882aa664"`);
        await queryRunner.query(`ALTER TABLE "activity_logs" DROP CONSTRAINT "FK_aa1910cacfdec3615476cf205bd"`);
        await queryRunner.query(`ALTER TABLE "crops" DROP CONSTRAINT "FK_25fdc9bbc32d36d7065b0a5f039"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_f3d6aea8fcca58182b2e80ce979"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_53fabd3505332b2b13c0ebaa7e"`);
        await queryRunner.query(`DROP TABLE "field_history"`);
        await queryRunner.query(`DROP TABLE "organizations"`);
        await queryRunner.query(`DROP TYPE "public"."organizations_plan_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_51aa469f258ad561565978d48a"`);
        await queryRunner.query(`DROP TABLE "farms"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bf7c9f84f072f0f0c035b7ec39"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_405630ac29fc182b50f882aa66"`);
        await queryRunner.query(`DROP TABLE "fields"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aa1910cacfdec3615476cf205b"`);
        await queryRunner.query(`DROP TABLE "activity_logs"`);
        await queryRunner.query(`DROP TYPE "public"."activity_logs_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_25fdc9bbc32d36d7065b0a5f03"`);
        await queryRunner.query(`DROP TABLE "crops"`);
        await queryRunner.query(`DROP TYPE "public"."crops_growthstage_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_963f754ca57419dac07d497e2f"`);
        await queryRunner.query(`DROP TABLE "scout_tasks"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_80bf5a029c26afc0f68027793e"`);
        await queryRunner.query(`DROP TABLE "weather_snapshots"`);
    }

}
