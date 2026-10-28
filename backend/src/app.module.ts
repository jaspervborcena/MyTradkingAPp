import { Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { BinanceMarketDataService } from './binance-market-data.service';
import { BinanceController } from './binance.controller';
import { BinanceSecretsService } from './binance-secrets.service';
import { BinanceService } from './binance.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { IndicatorService } from './indicator.service';
import { MarketDataLoggerService } from './market-data-logger.service';
import { NetworkDiagnosticsController } from './network-diagnostics.controller';
import { ScannerService } from './scanner.service';
import { StrategyService } from './strategy.service';
import { WatchlistAnalysisController } from './watchlist-analysis.controller';
import { WatchlistAnalysisService } from './watchlist-analysis.service';

@Module({
  controllers: [BinanceController, NetworkDiagnosticsController, WatchlistAnalysisController],
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
    WatchlistAnalysisService,
  ],
})
export class AppModule {}
