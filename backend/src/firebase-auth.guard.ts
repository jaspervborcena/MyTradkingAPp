import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(FirebaseAuthGuard.name);

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
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : 'unknown';
      this.logger.warn(`firebase_id_token_verification_failed code=${code}`);
      throw new UnauthorizedException('The Firebase ID token is invalid or expired.');
    }

    request.firebaseUser = user;
    return true;
  }
}
