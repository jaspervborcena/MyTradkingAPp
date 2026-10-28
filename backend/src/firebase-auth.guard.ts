import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { firebaseAuth } from './firebase-admin';

interface AuthenticatedRequest extends Request {
  firebaseUser?: DecodedIdToken;
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';

    if (!token) {
      throw new UnauthorizedException('Sign in with Firebase before requesting Binance data.');
    }

    let user: DecodedIdToken;
    try {
      user = await firebaseAuth.verifyIdToken(token, true);
    } catch {
      throw new UnauthorizedException('The Firebase ID token is invalid or expired.');
    }

    request.firebaseUser = user;
    return true;
  }
}
