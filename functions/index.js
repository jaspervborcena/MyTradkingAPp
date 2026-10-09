const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { spawn } = require('child_process');
const path = require('path');

admin.initializeApp();

const scheduleExpression = process.env.SCHEDULE_INTERVAL || 'every 5 minutes';

setGlobalOptions({
  region: 'us-central1',
  timeoutSeconds: 540,
  memory: '1GiB',
});

function runPythonScanner() {
  return new Promise((resolve, reject) => {
    const repoRoot = path.join(__dirname, '..');
    const child = spawn('python', ['-m', 'src.main'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error('scheduled_scan_start_failed', error);
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`python app exited with code ${code}`));
    });
  });
}

async function getAppConfig() {
  try {
    const db = admin.firestore();
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
      enabled: true,
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

  await docRef.set({ last_run_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
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
      await runPythonScanner();
      if (config.docRef) {
        await updateLastRun(config.docRef);
      }
      console.log('Scheduled market scan completed successfully');
    } catch (error) {
      console.error('Scheduled market scan failed', error);
      throw error;
    }
  }
);
