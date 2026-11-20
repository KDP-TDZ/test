import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const FALLBACK_FIREBASE_CONFIG: FirebaseAppletConfig = {
  projectId: 'gen-lang-client-0000361568',
  appId: '1:872979635387:web:1666b7019ecb7065645d9e',
  apiKey: 'AIzaSyDK6J4IvA0KFV7_28CpspJvOFrhR-BlIPE',
  authDomain: 'gen-lang-client-0000361568.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-a93ebbc7-3820-4590-85b7-c81b44ed2e49',
  storageBucket: 'gen-lang-client-0000361568.firebasestorage.app',
  messagingSenderId: '872979635387',
};

function loadFirebaseConfig(): FirebaseAppletConfig {
  const candidates: string[] = [path.resolve(process.cwd(), 'firebase-applet-config.json')];
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.resolve(currentDir, '../../firebase-applet-config.json'),
      path.resolve(currentDir, '../firebase-applet-config.json'),
      path.resolve(currentDir, 'firebase-applet-config.json')
    );
  } catch {
    // Ignore if import.meta.url is unavailable in a bundled context
  }

  let parsed: Partial<FirebaseAppletConfig> = {};
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as Partial<FirebaseAppletConfig>;
        break;
      }
    } catch {
      // Try next candidate path
    }
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || parsed.projectId || FALLBACK_FIREBASE_CONFIG.projectId,
    appId: process.env.FIREBASE_APP_ID?.trim() || parsed.appId || FALLBACK_FIREBASE_CONFIG.appId,
    apiKey: process.env.FIREBASE_API_KEY?.trim() || parsed.apiKey || FALLBACK_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || parsed.authDomain || FALLBACK_FIREBASE_CONFIG.authDomain,
    firestoreDatabaseId:
      process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() ||
      parsed.firestoreDatabaseId ||
      FALLBACK_FIREBASE_CONFIG.firestoreDatabaseId,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET?.trim() || parsed.storageBucket || FALLBACK_FIREBASE_CONFIG.storageBucket,
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID?.trim() ||
      parsed.messagingSenderId ||
      FALLBACK_FIREBASE_CONFIG.messagingSenderId,
  };
}

export const firebaseConfig: FirebaseAppletConfig = loadFirebaseConfig();

const DEFAULT_SUPER_ADMIN_EMAILS = ['tuankhang2011pm@gmail.com', 'tuankhangnek@gmail.com'];

export const PROTECTED_SUPER_ADMIN_EMAILS = new Set(
  DEFAULT_SUPER_ADMIN_EMAILS.map((e) => e.trim().toLowerCase())
);

export const SUPER_ADMIN_EMAILS: Set<string> = new Set(
  [
    ...DEFAULT_SUPER_ADMIN_EMAILS,
    ...(process.env.SUPER_ADMIN_EMAIL || '').split(','),
    ...(process.env.SUPER_ADMIN_EMAILS || '').split(','),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

export const SUPER_ADMIN_EMAIL =
  (process.env.SUPER_ADMIN_EMAIL || 'tuankhang2011pm@gmail.com').trim().toLowerCase();
export const SUPER_ADMIN_UID = (process.env.SUPER_ADMIN_UID || '').trim();

let adminAuthInstance: Auth | null = null;
try {
  const adminApp = getApps().length
    ? getApp()
    : initializeApp({
        projectId: firebaseConfig.projectId,
      });
  adminAuthInstance = getAuth(adminApp);
} catch (err) {
  console.warn('Warning: firebase-admin auth init skipped, using IdentityToolkit fallback:', err);
}

export const adminAuth: Auth | null = adminAuthInstance;

export interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  idToken: string;
  decoded: DecodedIdToken;
}

export function isDecodedSuperAdmin(decoded: DecodedIdToken): boolean {
  if (decoded.superAdmin === true || decoded.role === 'super_admin') {
    return true;
  }
  if (SUPER_ADMIN_UID && decoded.uid === SUPER_ADMIN_UID) {
    return true;
  }
  if (decoded.email_verified === true && decoded.email && SUPER_ADMIN_EMAILS.has(decoded.email.toLowerCase())) {
    return true;
  }
  return false;
}

async function verifyTokenViaIdentityToolkit(idToken: string): Promise<{
  uid: string;
  email: string;
  emailVerified: boolean;
}> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    throw new Error(`AUTH_LOOKUP_FAILED (${res.status})`);
  }
  const data = (await res.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
    }>;
  };
  const fbUser = data.users?.[0];
  if (!fbUser?.localId) {
    throw new Error('AUTH_USER_NOT_FOUND');
  }
  return {
    uid: fbUser.localId,
    email: fbUser.email || '',
    emailVerified: Boolean(fbUser.emailVerified),
  };
}

interface CachedVerifiedToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  decoded: DecodedIdToken;
  expiresAt: number;
}

const TOKEN_CACHE_TTL_MS = 90_000;
const verifiedTokenCache = new Map<string, CachedVerifiedToken>();

export function invalidateVerifiedTokenCacheForUid(uid?: string): void {
  if (!uid) {
    verifiedTokenCache.clear();
    return;
  }
  for (const [k, v] of verifiedTokenCache.entries()) {
    if (v.uid === uid) {
      verifiedTokenCache.delete(k);
    }
  }
}

function getJwtExpMs(idToken: string): number | null {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function verifyFirebaseRequest(req: Request): Promise<AuthenticatedUser> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('AUTH_MISSING_TOKEN');
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new Error('AUTH_MISSING_TOKEN');
  }

  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const now = Date.now();
  const cached = verifiedTokenCache.get(tokenHash);
  if (cached && now < cached.expiresAt) {
    return {
      uid: cached.uid,
      email: cached.email,
      emailVerified: cached.emailVerified,
      isSuperAdmin: cached.isSuperAdmin,
      idToken,
      decoded: cached.decoded,
    };
  }
  if (cached) {
    verifiedTokenCache.delete(tokenHash);
  }

  let uid = '';
  let email = '';
  let emailVerified = false;
  let decoded: DecodedIdToken | undefined;
  let isSuperAdmin = false;

  try {
    if (!adminAuth) {
      throw new Error('ADMIN_AUTH_UNAVAILABLE');
    }
    decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email || '';
    emailVerified = Boolean(decoded.email_verified);
    isSuperAdmin = isDecodedSuperAdmin(decoded);
  } catch {
    const verified = await verifyTokenViaIdentityToolkit(idToken);
    uid = verified.uid;
    email = verified.email;
    emailVerified = verified.emailVerified;
    isSuperAdmin =
      (SUPER_ADMIN_UID && uid === SUPER_ADMIN_UID) ||
      (emailVerified && email && SUPER_ADMIN_EMAILS.has(email.toLowerCase())) ||
      false;
  }

  if (!isSuperAdmin && emailVerified) {
    try {
      const adminDoc = await firestoreRestGet<{ role?: string }>(`admins/${uid}`, idToken);
      if (adminDoc?.role === 'super_admin') {
        isSuperAdmin = true;
      }
    } catch {
      // User is not in /admins/{uid}
    }
  }

  const finalDecoded = (decoded || { uid, email, email_verified: emailVerified }) as DecodedIdToken;
  const jwtExpMs = getJwtExpMs(idToken);
  const cacheExp = jwtExpMs
    ? Math.min(now + TOKEN_CACHE_TTL_MS, jwtExpMs - 5_000)
    : now + TOKEN_CACHE_TTL_MS;

  if (cacheExp > now + 1000) {
    if (verifiedTokenCache.size >= 500) {
      const oldestKey = verifiedTokenCache.keys().next().value;
      if (oldestKey) verifiedTokenCache.delete(oldestKey);
    }
    verifiedTokenCache.set(tokenHash, {
      uid,
      email,
      emailVerified,
      isSuperAdmin,
      decoded: finalDecoded,
      expiresAt: cacheExp,
    });
  }

  return {
    uid,
    email,
    emailVerified,
    isSuperAdmin,
    idToken,
    decoded: finalDecoded,
  };
}

// --- Firestore REST helpers using the caller's verified Firebase ID token ---
function encodeFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function decodeFirestoreValue(val: Record<string, unknown>): unknown {
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('arrayValue' in val) {
    const arr = (val.arrayValue as { values?: Record<string, unknown>[] })?.values || [];
    return arr.map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const fields = (val.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields || {};
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

function firestoreDocBaseUrl(): string {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${encodeURIComponent(dbId)}/documents`;
}

export async function firestoreRestGet<T = Record<string, unknown>>(
  docPath: string,
  idToken: string
): Promise<T | null> {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_GET_FAILED (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as { fields?: Record<string, Record<string, unknown>> };
  if (!data.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data.fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out as T;
}

export async function firestoreRestSet(
  docPath: string,
  payload: Record<string, unknown>,
  idToken: string
): Promise<void> {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_SET_FAILED (${res.status}): ${txt}`);
  }
}

export async function firestoreRestList<T = Record<string, unknown>>(
  collectionPath: string,
  idToken: string,
  pageSize = 100
): Promise<T[]> {
  const url = `${firestoreDocBaseUrl()}/${collectionPath}?pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_LIST_FAILED (${res.status}): ${txt}`);
  }
  const json = (await res.json()) as {
    documents?: Array<{ fields?: Record<string, Record<string, unknown>> }>;
  };
  const docs = json.documents || [];
  return docs.map((doc) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out as T;
  });
}

export async function firestoreRestDelete(docPath: string, idToken: string): Promise<void> {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_DELETE_FAILED (${res.status}): ${txt}`);
  }
}
