/// <reference types="vite/client" />
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import localFirebaseConfig from '../firebase-applet-config.json';

// Configuration prioritization:
// 1. Environment variables from AI Studio (VITE_ prefixed)
// 2. Local config from firebase-applet-config.json (Source of truth)
const firebaseConfig = {
  ...localFirebaseConfig,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || localFirebaseConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || localFirebaseConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || localFirebaseConfig.projectId,
};

// Initialize Firebase
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore with robust settings
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
}, firebaseConfig.firestoreDatabaseId || '(default)');

const auth = getAuth(app);

// Critical Logging for Debugging
console.log("[FIREBASE] Active Project ID:", firebaseConfig.projectId);
console.log("[FIREBASE] Using API Key:", firebaseConfig.apiKey.substring(0, 10) + "...");
console.log("[FIREBASE] Auth Domain:", firebaseConfig.authDomain);

export { app, db, auth, firebaseConfig };
