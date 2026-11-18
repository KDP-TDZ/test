import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

export interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
export const firebaseConfig: FirebaseAppletConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'tuankhang2011pm@gmail.com').trim().toLowerCase();
export const SUPER_ADMIN_UID = (process.env.SUPER_ADMIN_UID || '').trim();

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(adminApp);

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
  if (decoded.email_verified === true && decoded.email && decoded.email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return true;
  }
  return false;
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
  const decoded = await adminAuth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    emailVerified: Boolean(decoded.email_verified),
    isSuperAdmin: isDecodedSuperAdmin(decoded),
    idToken,
    decoded,
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
