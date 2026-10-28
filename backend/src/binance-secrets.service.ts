import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

export interface BinanceApiCredentials {
  apiKey: string;
  apiSecret: string;
}

@Injectable()
export class BinanceSecretsService {
  private readonly logger = new Logger(BinanceSecretsService.name);
  private readonly client = new SecretManagerServiceClient();
  private readonly values = new Map<string, Promise<string>>();

  constructor(private readonly appConfig: AppConfigService) {}

  async getCredentials(): Promise<BinanceApiCredentials> {
    const projectId = process.env.SECRET_MANAGER_PROJECT_ID
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GCP_PROJECT
      ?? this.appConfig.config.firebase.project_id;
    if (!projectId) {
      throw new ServiceUnavailableException(
        'Google Secret Manager is not configured with a project ID.',
      );
    }

    const apiKeySecret = process.env.BINANCE_API_KEY_SECRET_ID ?? 'BINANCE_API_KEY';
    const apiSecretSecret = process.env.BINANCE_SECRET_SECRET_ID ?? 'BINANCE_SECRET';
    const [apiKey, apiSecret] = await Promise.all([
      this.readSecret(projectId, apiKeySecret),
      this.readSecret(projectId, apiSecretSecret),
    ]);
    return { apiKey, apiSecret };
  }

  private readSecret(projectId: string, secretId: string): Promise<string> {
    const cached = this.values.get(secretId);
    if (cached) {
      return cached;
    }

    const secret = this.accessSecret(projectId, secretId);
    this.values.set(secretId, secret);
    void secret.catch(() => this.values.delete(secretId));
    return secret;
  }

  private async accessSecret(projectId: string, secretId: string): Promise<string> {
    const name = `projects/${projectId}/secrets/${secretId}/versions/latest`;
    try {
      const [version] = await this.client.accessSecretVersion({ name });
      const value = version.payload?.data?.toString('utf8');
      if (!value) {
        this.logger.error(`secret_manager_secret_empty secret=${secretId}`);
        throw new ServiceUnavailableException(
          `Secret Manager secret ${secretId} is empty or unavailable.`,
        );
      }
      return value;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(`secret_manager_access_failed secret=${secretId}`);
      throw new ServiceUnavailableException(
        `Could not access Secret Manager secret ${secretId}. Verify the secret exists and the runtime identity has Secret Accessor permission.`,
      );
    }
  }
}
