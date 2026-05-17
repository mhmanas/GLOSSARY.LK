import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config';

// Configuration prioritized: Environment Variables (VITE_*) > Local Config File
const getFirebaseConfig = () => {
  const env = import.meta.env;
  
  // If API Key is provided via Env Var and it's not a placeholder, use exclusively Env Vars (Production mode)
  const isEnvValid = env.VITE_FIREBASE_API_KEY && 
                    env.VITE_FIREBASE_API_KEY !== 'REPLACE_ME' && 
                    env.VITE_FIREBASE_API_KEY.length > 20 &&
                    !env.VITE_FIREBASE_API_KEY.includes('...');

  if (isEnvValid) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
      firestoreDatabaseId: env.VITE_FIREBASE_DATABASE_ID,
    };
  }

  // Otherwise fallback to the applet config (Development/AI Studio mode)
  return {
    apiKey: firebaseAppletConfig.apiKey,
    authDomain: firebaseAppletConfig.authDomain,
    projectId: firebaseAppletConfig.projectId,
    storageBucket: firebaseAppletConfig.storageBucket,
    messagingSenderId: firebaseAppletConfig.messagingSenderId,
    appId: firebaseAppletConfig.appId,
    measurementId: firebaseAppletConfig.measurementId,
    firestoreDatabaseId: firebaseAppletConfig.firestoreDatabaseId,
  };
};

const firebaseConfig = getFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Validation connection test
async function testConnection() {
  if (!firebaseConfig.apiKey) {
    console.error("Firebase API Key is missing. Please check your configuration.");
    return;
  }
  
  try {
    // Only test if we are in development or if explicitly requested
    if (import.meta.env.DEV) {
      await getDocFromServer(doc(db, 'test', 'connection'));
    }
  } catch (error) {
    console.warn("Initial Firebase connection check failed. This might be due to missing collections or restricted rules, but the app may still function if config is correct.", error);
  }
}
testConnection();

export const login = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

// Error Handler Pattern
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
