import { Injectable } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { firestore } from './firebase-admin';
import { AppConfigService } from './app-config.service';
import type { MarketEvent } from './market.types';

@Injectable()
export class MarketDataLoggerService {
  private readonly observationsPath: string;
  private readonly signalsPath: string;

  constructor(private readonly appConfig: AppConfigService) {
    this.observationsPath = resolve(appConfig.dataDir, 'market_observations.jsonl');
    this.signalsPath = resolve(appConfig.dataDir, 'market_signals.jsonl');
  }

  async logObservation(event: MarketEvent): Promise<void> {
    await this.append(this.observationsPath, event);
    await this.writeFirestore(event);
  }

  async logSignal(event: MarketEvent): Promise<void> {
    await this.append(this.signalsPath, event);
    await this.writeFirestore(event);
  }

  private async append(filePath: string, event: MarketEvent): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  private async writeFirestore(event: MarketEvent): Promise<void> {
    if (this.appConfig.config.firebase.enabled) {
      await firestore.collection('market_events').add(event);
    }
  }
}
