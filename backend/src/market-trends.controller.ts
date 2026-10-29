import { Controller, Get, UseGuards } from '@nestjs/common';
import { BinanceMarketDataService } from './binance-market-data.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Controller('api/market-trends')
@UseGuards(FirebaseAuthGuard)
export class MarketTrendsController {
  constructor(private readonly marketData: BinanceMarketDataService) {}

  @Get('tickers')
  getTickers() {
    return this.marketData.fetchMarketTrendTickers();
  }
}
