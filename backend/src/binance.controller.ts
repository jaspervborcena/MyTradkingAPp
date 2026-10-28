import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { BinanceService } from './binance.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';

interface FirebaseRequest extends Request {
  firebaseUser: DecodedIdToken;
}

@Controller('api/binance')
@UseGuards(FirebaseAuthGuard)
export class BinanceController {
  constructor(private readonly binance: BinanceService) {}

  @Get('status')
  getStatus(@Req() request: FirebaseRequest): Promise<{ connected: boolean }> {
    return this.binance.getUserStatus(request.firebaseUser.uid);
  }

  @Get('account')
  getAccount() {
    return this.binance.getAccount();
  }

  @Post('order')
  placeMarketOrder(@Req() request: FirebaseRequest, @Body() body: unknown) {
    return this.binance.placeMarketOrder(request.firebaseUser.uid, body);
  }
}
