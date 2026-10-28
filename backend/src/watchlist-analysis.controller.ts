import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { WatchlistAnalysisService } from './watchlist-analysis.service';

interface FirebaseRequest extends Request {
  firebaseUser: DecodedIdToken;
}

@Controller('api/analysis')
@UseGuards(FirebaseAuthGuard)
export class WatchlistAnalysisController {
  constructor(private readonly analysis: WatchlistAnalysisService) {}

  @Post('watchlist')
  analyzeWatchlist(@Req() request: FirebaseRequest, @Body() body: unknown) {
    return this.analysis.analyze(request.firebaseUser.uid, body);
  }
}
