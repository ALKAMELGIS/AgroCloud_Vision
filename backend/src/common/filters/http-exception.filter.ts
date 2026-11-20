import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Always send `message` as a plain string so clients never render "[object Object]".
    // Nest's getResponse() may be a string or { message: string | string[], error, statusCode }.
    let message = 'Internal server error';
    // Structured details a client can act on (e.g. code + conflicts for overlapping fields).
    let extra: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      const body = exception.getResponse() as any;
      const raw = typeof body === 'string' ? body : body?.message ?? exception.message;
      message = Array.isArray(raw) ? raw.join(', ') : String(raw);
      if (body && typeof body === 'object' && typeof body.code === 'string') {
        const { message: _m, statusCode: _s, error: _e, ...rest } = body;
        extra = rest;
      }
    }

    if (status >= 500) {
      this.logger.error(exception as any);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      message,
      ...extra,
    });
  }
}
