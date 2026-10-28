const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { GoogleAuth } = require('google-auth-library');

admin.initializeApp();
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const scheduleExpression = process.env.SCHEDULE_INTERVAL || 'every 5 minutes';

setGlobalOptions({
  region: 'asia-east1',
  timeoutSeconds: 540,
  memory: '1GiB',
});

async function startScannerJob(profileName) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || admin.app().options.projectId;
  if (!projectId) {
    throw new Error('Google Cloud project ID is not available to the scheduled function');
  }
  const region = process.env.SCANNER_JOB_REGION || 'asia-southeast1';
  const jobName = process.env.SCANNER_JOB_NAME || 'trading-market-scan';
  const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${region}/jobs/${jobName}:run`;
  const client = await googleAuth.getClient();
  const token = await client.getAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.token || token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(profileName ? {
      overrides: {
        containerOverrides: [{
          env: [{ name: 'PROFILE', value: profileName }],
        }],
      },
    } : {}),
  });

  if (!response.ok) {
    throw new Error(`Cloud Run Job launch failed (${response.status}): ${await response.text()}`);
  }

  const operation = await response.json();
  console.log(`scanner_job_started name=${jobName} operation=${operation.name || 'unknown'}`);
}

function scheduleRiskProfile(profileName) {
  return onSchedule(
    {
      schedule: scheduleExpression,
      timeZone: 'UTC',
      retryCount: 1,
    },
    async () => {
      const appConfig = await getAppConfig();
      if (!appConfig.enabled) {
        console.log(`Skipping ${profileName} scan because app_config.enabled is false`);
        return;
      }

      const profileRef = getFirestore().collection('risk_profiles').doc(profileName);
      const snapshot = await profileRef.get();
      if (!snapshot.exists) {
        console.warn(`Skipping ${profileName} scan because risk_profiles/${profileName} is missing`);
        return;
      }
      const profile = snapshot.data() || {};
      if (profile.enabled !== true) {
        console.log(`Skipping ${profileName} scan because the profile is disabled`);
        return;
      }

      const intervalMinutes = Number(profile.interval_minutes ?? 5);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
        throw new Error(`risk_profiles/${profileName}.interval_minutes must be a positive number`);
      }
      const lastRunAt = profile.last_run_at;
      if (lastRunAt && lastRunAt.toDate) {
        const elapsedMinutes = (Date.now() - lastRunAt.toDate().getTime()) / 60000;
        if (elapsedMinutes < intervalMinutes) {
          console.log(`Skipping ${profileName} scan; last run was ${elapsedMinutes.toFixed(1)} minutes ago`);
          return;
        }
      }

      await startScannerJob(profileName);
      await profileRef.set({ last_run_at: FieldValue.serverTimestamp() }, { merge: true });
      console.log(`Scheduled ${profileName} market scan submitted successfully`);
    },
  );
}

async function getAppConfig() {
  try {
    const db = getFirestore();
    const snapshot = await db.collection('app_config').limit(1).get();

    if (snapshot.empty) {
      return {
        enabled: true,
        mode: 'test',
        interval_minutes: 15,
      };
    }

    const doc = snapshot.docs[0];
    const data = doc.data() || {};

    return {
      enabled: data.enabled !== false,
      mode: typeof data.mode === 'string' ? data.mode : 'test',
      interval_minutes: Number(data.interval_minutes ?? 15),
      docId: doc.id,
      docRef: doc.ref,
    };
  } catch (error) {
    console.warn('app_config_load_failed', error);
    return {
      enabled: false,
      mode: 'test',
      interval_minutes: 15,
      docId: null,
      docRef: null,
    };
  }
}

exports.trading_scanMarket_high = scheduleRiskProfile('high');
exports.trading_scanMarket_medium = scheduleRiskProfile('medium');
exports.trading_scanMarket_slow = scheduleRiskProfile('slow');

exports.getBinanceStatus = onCall(
  {
    region: 'asia-east1',
    cors: [
      'https://tradingdashboard--mytradingapp-50d29.asia-east1.hosted.app',
    ],
  },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in before checking Binance status.');
    }

    const integration = await getFirestore()
      .doc(`users/${uid}/integrations/binance`)
      .get();
    return { connected: integration.exists && integration.data()?.enabled === true };
  },
);

exports.binanceApi = onRequest(
  {
    region: 'asia-east1',
    timeoutSeconds: 60,
    memory: '512MiB',
    serviceAccount: 'binance-api-runtime@mytradingapp-50d29.iam.gserviceaccount.com',
    invoker: 'public',
    secrets: ['OPENAI_SECRET'],
  },
  async (request, response) => {
    try {
      const { getServerlessApplication } = require('./backend/runtime/serverless');
      const app = await getServerlessApplication();
      app(request, response);
    } catch (error) {
      console.error('binance_api_initialization_failed', error);
      if (!response.headersSent) {
        response.status(500).json({ statusCode: 500, message: 'API initialization failed' });
      }
    }
  },
);
