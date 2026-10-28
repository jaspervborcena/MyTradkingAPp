import 'reflect-metadata';
import type { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigService } from './app-config.service';
import { AppModule } from './app.module';

const allowedOrigins = [
  /^http:\/\/localhost:\d+$/,
  'https://mytradingapp-50d29.web.app',
  'https://mytradingapp-50d29.firebaseapp.com',
  'https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app',
];

async function bootstrap(): Promise<void> {
  const logLevels: Record<string, LogLevel[]> = {
    DEBUG: ['debug', 'log', 'warn', 'error', 'fatal'],
    INFO: ['log', 'warn', 'error', 'fatal'],
    WARNING: ['warn', 'error', 'fatal'],
    ERROR: ['error', 'fatal'],
    CRITICAL: ['fatal'],
  };
  const logger = logLevels[new AppConfigService().config.logLevel];

  if (process.env.SCAN_ONCE?.toLowerCase() === 'true') {
    const app = await NestFactory.createApplicationContext(AppModule, { logger });
    await app.close();
    return;
  }

  const app = await NestFactory.create(AppModule, { logger });
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed = !origin || allowedOrigins.some(candidate =>
        typeof candidate === 'string' ? candidate === origin : candidate.test(origin));
      callback(null, allowed);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap().catch(error => {
  console.error('NestJS startup failed', error);
  process.exitCode = 1;
});
