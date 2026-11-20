import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WeatherService } from './weather.service';

@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  /**
   * GET /weather/field/:fieldId/forecast?lat=..&lng=..&start=YYYY-MM-DD&end=YYYY-MM-DD
   */
  @Get('field/:fieldId/forecast')
  getForecast(
    @Param('fieldId') fieldId: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.weatherService.fetchDailyWeather({
      fieldId,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      startDate: start,
      endDate: end,
      historical: false,
    });
  }

  @Get('field/:fieldId/history')
  getHistory(
    @Param('fieldId') fieldId: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    return this.weatherService.fetchDailyWeather({
      fieldId,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      startDate: start,
      endDate: end,
      historical: true,
    });
  }

  @Get('field/:fieldId/cached')
  getCached(@Param('fieldId') fieldId: string) {
    return this.weatherService.getCachedHistory(fieldId);
  }
}
