import 'reflect-metadata';
import type { Express } from 'express';
import type { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppConfigService } from './app-config.service';
import { AppModule } from './app.module';

const allowedOrigins = [
  /^http:\/\/localhost:\d+$/,
  'https://mytradingapp-50d29.web.app',
  'https://mytradingapp-50d29.firebaseapp.com',
];

let application: Promise<Express> | undefined;

export function getServerlessApplication(): Promise<Express> {
  application ??= createServerlessApplication();
  return application;
}

async function createServerlessApplication(): Promise<Express> {
  process.env.API_ONLY = 'true';
  const logLevels: Record<string, LogLevel[]> = {
    DEBUG: ['debug', 'log', 'warn', 'error', 'fatal'],
    INFO: ['log', 'warn', 'error', 'fatal'],
    WARNING: ['warn', 'error', 'fatal'],
    ERROR: ['error', 'fatal'],
    CRITICAL: ['fatal'],
  };
  const logger = logLevels[new AppConfigService().config.logLevel];
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
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  await app.init();
  return app.getHttpAdapter().getInstance() as Express;
}
