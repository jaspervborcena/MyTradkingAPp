import { BadGatewayException, Controller, Get, UseGuards } from '@nestjs/common';
import { isIP } from 'node:net';
import { FirebaseAuthGuard } from './firebase-auth.guard';

@Controller()
@UseGuards(FirebaseAuthGuard)
export class NetworkDiagnosticsController {
  @Get('ip')
  async getEgressIp(): Promise<{ ip: string }> {
    let response: Response;
    try {
      response = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new BadGatewayException('Could not determine the backend public egress IP.');
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `The public IP lookup service returned HTTP ${response.status}.`,
      );
    }

    let payload: { ip?: unknown };
    try {
      payload = await response.json() as typeof payload;
    } catch {
      throw new BadGatewayException('The public IP lookup service returned invalid JSON.');
    }

    if (typeof payload.ip !== 'string' || isIP(payload.ip) === 0) {
      throw new BadGatewayException('The public IP lookup service returned an invalid IP address.');
    }

    return { ip: payload.ip };
  }
}
