import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { AppConfigService } from './app-config.service';

const configProjectId = new AppConfigService().config.firebase.project_id;

const app = getApps().length
  ? getApp()
  : initializeApp({
      credential: applicationDefault(),
      projectId:
        process.env.FIREBASE_PROJECT_ID
        ?? process.env.GCLOUD_PROJECT
        ?? process.env.GCP_PROJECT
        ?? process.env.GOOGLE_CLOUD_PROJECT
        ?? configProjectId
        ?? undefined,
    });

export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
