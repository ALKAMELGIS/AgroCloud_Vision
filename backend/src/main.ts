import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  // Only the product's own pages may call the API from a browser.
  // Extra origins: CORS_ORIGINS="https://a.example,https://b.example"
  const extra = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed: (string | RegExp)[] = [
    'https://alkamelgis.github.io',
    /^https:\/\/agrocloud-frontend[\w-]*\.onrender\.com$/,
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    ...extra,
  ];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    cors: {
      origin: allowed,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    },
  });
  // Imported field boundaries (Shapefile / GDB / GPKG) can carry thousands of
  // vertices, far above Express's 100 kB default JSON limit.
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AgroSyntra One API running on http://localhost:${port}/api/v1`);
}
bootstrap();
