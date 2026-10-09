const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { GoogleAuth } = require('google-auth-library');

admin.initializeApp();
const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const scheduleExpression = process.env.SCHEDULE_INTERVAL || 'every 5 minutes';

setGlobalOptions({
  region: 'us-central1',
  timeoutSeconds: 540,
  memory: '1GiB',
});

async function startPythonScannerJob() {
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
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`Cloud Run Job launch failed (${response.status}): ${await response.text()}`);
  }

  const operation = await response.json();
  console.log(`scanner_job_started name=${jobName} operation=${operation.name || 'unknown'}`);
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

async function updateLastRun(docRef) {
  if (!docRef) {
    return;
  }

  await docRef.set({ last_run_at: FieldValue.serverTimestamp() }, { merge: true });
}

exports.trading_scanMarket = onSchedule(
  {
    schedule: scheduleExpression,
    timeZone: 'UTC',
    retryCount: 1,
    region: 'us-central1',
  },
  async () => {
    const config = await getAppConfig();

    if (!config.enabled) {
      console.log('Skipping scheduled scan because app_config.enabled is false');
      return;
    }

    if (config.mode !== 'test' && config.mode !== 'prod') {
      console.log(`Unsupported app mode: ${config.mode}; defaulting to test`);
    }

    const intervalMinutes = Number(config.interval_minutes ?? 15);
    const docData = config.docRef ? (await config.docRef.get()).data() || {} : {};
    const lastRunAt = docData.last_run_at;

    if (lastRunAt && lastRunAt.toDate) {
      const elapsedMinutes = (Date.now() - lastRunAt.toDate().getTime()) / 60000;
      if (elapsedMinutes < intervalMinutes) {
        console.log(`Skipping scan because last_run_at was ${elapsedMinutes.toFixed(1)} minutes ago and interval_minutes=${intervalMinutes}`);
        return;
      }
    }

    console.log(`Starting scheduled market scan for mode=${config.mode || 'test'} interval_minutes=${intervalMinutes}`);
    try {
      await startPythonScannerJob();
      if (config.docRef) {
        await updateLastRun(config.docRef);
      }
      console.log('Scheduled market scan job submitted successfully');
    } catch (error) {
      console.error('Scheduled market scan failed', error);
      throw error;
    }
  }
);
