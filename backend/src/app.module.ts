import { Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { BinanceMarketDataService } from './binance-market-data.service';
import { BinanceController } from './binance.controller';
import { BinanceSecretsService } from './binance-secrets.service';
import { BinanceService } from './binance.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { IndicatorService } from './indicator.service';
import { MarketDataLoggerService } from './market-data-logger.service';
import { ScannerService } from './scanner.service';
import { StrategyService } from './strategy.service';

@Module({
  controllers: [BinanceController],
  providers: [
    AppConfigService,
    BinanceMarketDataService,
    BinanceSecretsService,
    BinanceService,
    FirebaseAuthGuard,
    IndicatorService,
    MarketDataLoggerService,
    ScannerService,
    StrategyService,
  ],
})
export class AppModule {}
