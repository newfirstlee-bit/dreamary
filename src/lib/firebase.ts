import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth, initializeAuth, browserLocalPersistence } from "firebase/auth";
import { Capacitor } from "@capacitor/core";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Native WebViews can delay or block Firestore's initial WebSocket connection.
// Auto detection keeps the normal transport when it works and falls back only
// when needed, without forcing every request through long polling.
export const db = initializeFirestore(
  app,
  Capacitor.isNativePlatform() ? { experimentalAutoDetectLongPolling: true } : {}
);

// iOS Capacitor에서 IndexedDB 접근 시 응답이 지연되는 버그를 피하기 위해 localStorage를 강제합니다.
let authInstance;
try {
  authInstance = Capacitor.isNativePlatform()
    ? initializeAuth(app, { persistence: browserLocalPersistence })
    : getAuth(app);
} catch (e) {
  authInstance = getAuth(app);
}
export const auth = authInstance;
