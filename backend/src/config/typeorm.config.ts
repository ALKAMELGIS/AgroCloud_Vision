import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config();

// DATABASE_URL (e.g. the Supabase session pooler URI) wins over the DB_* parts.
// Hosted databases need TLS; Supabase's certificate chain is not in Node's
// default bundle, so the link is encrypted without pinning the CA.
const url = process.env.DATABASE_URL || undefined;
const local = !url || /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const ssl = process.env.DB_SSL === 'false' || local ? false : { rejectUnauthorized: false };

export const typeOrmConfig: DataSourceOptions = {
  type: 'postgres',
  ...(url
    ? { url, ssl }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'agrocloud',
        password: process.env.DB_PASSWORD || 'change_me',
        database: process.env.DB_DATABASE || 'agrocloud_vision',
      }),
  // The free Supabase pooler allows few connections; keep the pool small.
  extra: { max: parseInt(process.env.DB_POOL_MAX || '5', 10) },
  // Schema changes go through migrations (src/migrations), applied on start.
  // DB_SYNCHRONIZE=true is for throwaway local databases only.
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  migrationsRun: process.env.DB_MIGRATIONS_RUN !== 'false',
  logging: process.env.NODE_ENV === 'development',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
};

export default new DataSource(typeOrmConfig);
