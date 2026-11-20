import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeatherSnapshot } from './weather-snapshot.entity';

interface OpenMeteoDailyResponse {
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    windspeed_10m_max: number[];
  };
}

/**
 * خدمة الطقس الحقيقية — مبنية على محرّك Open-Meteo مفتوح المصدر:
 * https://github.com/open-meteo/open-meteo
 *
 * افتراضياً تستخدم الخدمة العامة المستضافة (api.open-meteo.com /
 * archive-api.open-meteo.com) - مجانية وبلا مفتاح API وتعمل فوراً.
 *
 * عند الرغبة بتشغيل محرّك Open-Meteo ذاتياً (self-hosted) من نفس المستودع
 * أعلاه (مثلاً عبر Docker على خادمك الخاص)، يكفي تعيين المتغيّرين التاليين
 * في backend/.env ليُعاد توجيه كل الطلبات إلى نسختك الخاصة دون أي تعديل كود:
 *
 *   OPEN_METEO_FORECAST_URL=http://localhost:8080/v1/forecast
 *   OPEN_METEO_ARCHIVE_URL=http://localhost:8080/v1/archive
 *
 * راجع قسم "تشغيل Open-Meteo ذاتياً" في README لخطوات الاستضافة الذاتية
 * الكاملة (استنساخ المستودع، مزامنة بيانات النماذج الجوية، تشغيل الحاوية).
 * هذا المتغيّر فارغ حالياً حسب طلبك — سيُستخدم المسار العام إلى أن تحدّده.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger('WeatherService');

  constructor(
    @InjectRepository(WeatherSnapshot)
    private readonly snapshotRepo: Repository<WeatherSnapshot>,
    private readonly configService: ConfigService,
  ) {}

  private get forecastUrl(): string {
    return (
      this.configService.get<string>('OPEN_METEO_FORECAST_URL') ||
      'https://api.open-meteo.com/v1/forecast'
    );
  }

  private get archiveUrl(): string {
    return (
      this.configService.get<string>('OPEN_METEO_ARCHIVE_URL') ||
      'https://archive-api.open-meteo.com/v1/archive'
    );
  }

  /**
   * يجلب طقس حقل معيّن (تاريخي أو توقعات) حسب الإحداثيات ونطاق التاريخ.
   * historical=true => Archive API (بيانات ماضية).
   * historical=false => Forecast API (توقعات حتى 16 يوماً + آخر أيام قليلة ماضية).
   */
  async fetchDailyWeather(params: {
    fieldId: string;
    latitude: number;
    longitude: number;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
    historical?: boolean;
  }) {
    const { fieldId, latitude, longitude, startDate, endDate, historical } = params;

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException('إحداثيات غير صالحة');
    }

    const base = historical ? this.archiveUrl : this.forecastUrl;
    const url = new URL(base);
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
    );
    url.searchParams.set('timezone', 'auto');

    let response: Response;
    try {
      response = await fetch(url.toString());
    } catch (err: any) {
      this.logger.error(`تعذّر الاتصال بخادم Open-Meteo (${base}): ${err.message}`);
      throw new BadRequestException(
        'تعذّر الاتصال بخدمة الطقس. إذا كنت تستخدم نسخة مستضافة ذاتياً تأكد أنها تعمل وأن عنوانها صحيح في .env',
      );
    }

    if (!response.ok) {
      this.logger.error(`Open-Meteo request failed (${base}): ${response.status}`);
      throw new BadRequestException('تعذّر جلب بيانات الطقس من المزوّد الخارجي');
    }

    const data = (await response.json()) as OpenMeteoDailyResponse;

    const days = data.daily.time.map((date, i) => ({
      date,
      temperatureMaxC: data.daily.temperature_2m_max[i],
      temperatureMinC: data.daily.temperature_2m_min[i],
      precipitationMm: data.daily.precipitation_sum[i],
      windSpeedMaxKmh: data.daily.windspeed_10m_max[i],
    }));

    // تخزين كمرجع (Cache) - لا يوقف الاستجابة إذا فشل
    this.cacheSnapshots(fieldId, days).catch((err) =>
      this.logger.warn(`تعذّر حفظ snapshot الطقس: ${err.message}`),
    );

    const source = base.includes('open-meteo.com') ? 'open-meteo' : 'open-meteo-self-hosted';
    return { fieldId, source, days };
  }

  private async cacheSnapshots(fieldId: string, days: any[]) {
    const entities = days.map((d) =>
      this.snapshotRepo.create({
        fieldId,
        date: d.date,
        temperatureMaxC: d.temperatureMaxC,
        temperatureMinC: d.temperatureMinC,
        precipitationMm: d.precipitationMm,
        windSpeedMaxKmh: d.windSpeedMaxKmh,
        source: 'open-meteo',
      }),
    );
    await this.snapshotRepo.save(entities);
  }

  getCachedHistory(fieldId: string) {
    return this.snapshotRepo.find({ where: { fieldId }, order: { date: 'DESC' } });
  }
}
