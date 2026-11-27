import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AiProviderId,
  CloudflareKeyStatus,
  ColdStartProviderReadiness,
  ColdStartReadinessReport,
  KeyTestStatus,
  ProviderKeysStatus,
  SingleApiKeyStatus,
} from '../core/types.js';
import {
  resolveScopedStageApiKey,
  type AdaptiveSlotNumber,
  type AdaptiveStageCode,
} from '../core/adaptiveApiPlan.js';
import {
  firestoreRestDelete,
  firestoreRestGet,
  firestoreRestSet,
} from './firebaseServer.js';
import { recordAuditLog } from './aiGuardService.js';
import { isGroqVisionModelId } from './groqProvider.js';

interface StoredEncryptedSecret {
  secretId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  maskedIdentifier: string;
  label: string;
  updatedAt: string;
  updatedBy: string;
  lastTestStatus?: KeyTestStatus;
  lastTestAt?: string;
  lastTestMessage?: string;
}

interface CachedSingleKey {
  rawKey: string;
  maskedKey: string;
  label: string;
  updatedAt: string;
  updatedBy: string;
  lastTestStatus?: KeyTestStatus;
  lastTestAt?: string;
  lastTestMessage?: string;
}

interface CachedCloudflareCredentials {
  accountId: string;
  apiToken: string;
  maskedAccountId: string;
  maskedKey: string;
  maskedIdentifier: string;
  label: string;
  updatedAt: string;
  updatedBy: string;
  lastTestStatus?: KeyTestStatus;
  lastTestAt?: string;
  lastTestMessage?: string;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');

const MISTRAL_ENCRYPTED_KEY_FILE = path.join(DATA_DIR, 'mistral-api-key.enc');
const TMP_MISTRAL_ENCRYPTED_KEY_FILE = path.join(os.tmpdir(), 'studycheck-mistral-api-key.enc');
const FIRESTORE_MISTRAL_DOC = 'adminSecrets/mistral';

const GROQ_ENCRYPTED_KEY_FILE = path.join(DATA_DIR, 'groq-api-key.enc');
const TMP_GROQ_ENCRYPTED_KEY_FILE = path.join(os.tmpdir(), 'studycheck-groq-api-key.enc');
const FIRESTORE_GROQ_DOC = 'adminSecrets/groq';

const CF_ENCRYPTED_KEY_FILE = path.join(DATA_DIR, 'cloudflare-ai-key.enc');
const TMP_CF_ENCRYPTED_KEY_FILE = path.join(os.tmpdir(), 'studycheck-cloudflare-ai-key.enc');
const FIRESTORE_CF_DOC = 'adminSecrets/cloudflare';

let ephemeralProcessAesKey: Buffer | null = null;
let warnedMissingEncryptionSecret = false;

export function isPersistentEncryptionSecretConfigured(): boolean {
  return Boolean(
    process.env.KEY_ENCRYPTION_SECRET?.trim() || process.env.ADMIN_KEY_ENCRYPTION_SECRET?.trim()
  );
}

function deriveAesKey(): Buffer {
  const configuredSeed =
    process.env.KEY_ENCRYPTION_SECRET?.trim() || process.env.ADMIN_KEY_ENCRYPTION_SECRET?.trim();
  if (configuredSeed) {
    return crypto.createHash('sha256').update(`studycheck-aes-v2:${configuredSeed}`).digest();
  }
  if (!ephemeralProcessAesKey) {
    ephemeralProcessAesKey = crypto.randomBytes(32);
    if (!warnedMissingEncryptionSecret) {
      warnedMissingEncryptionSecret = true;
      console.warn(
        'Security notice: KEY_ENCRYPTION_SECRET is not set. Using an ephemeral in-memory encryption key for this process; configure KEY_ENCRYPTION_SECRET in server environment variables before deploying.'
      );
    }
  }
  return ephemeralProcessAesKey;
}

export function encryptSecretPayload(rawValue: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawValue, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptSecretPayload(payload: { ciphertext: string; iv: string; authTag: string }): string {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveAesKey(),
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskApiKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

export function maskCompactSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return '••••';
  return `${trimmed.slice(0, 4)}••${trimmed.slice(-4)}`;
}

export function maskCloudflareIdentifier(accountId: string, apiToken: string): string {
  return `${maskCompactSecret(accountId)} / ${maskCompactSecret(apiToken)}`.slice(0, 40);
}

export function validateApiKeyInput(rawKey: string): { valid: boolean; reason?: string } {
  const trimmed = rawKey.trim();
  if (trimmed.length < 16) {
    return { valid: false, reason: 'API key quá ngắn (cần tối thiểu 16 ký tự).' };
  }
  if (trimmed.length > 512) {
    return { valid: false, reason: 'API key quá dài (tối đa 512 ký tự).' };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'API key không được chứa khoảng trắng hoặc xuống dòng.' };
  }
  return { valid: true };
}

export function validateCloudflareAccountId(accountId: string): { valid: boolean; reason?: string } {
  const trimmed = accountId.trim();
  if (trimmed.length < 16 || trimmed.length > 64) {
    return { valid: false, reason: 'Cloudflare Account ID phải dài từ 16 đến 64 ký tự.' };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Cloudflare Account ID chỉ được chứa chữ cái, chữ số, dấu gạch ngang hoặc gạch dưới.',
    };
  }
  return { valid: true };
}

export function validateCloudflareToken(apiToken: string): { valid: boolean; reason?: string } {
  const trimmed = apiToken.trim();
  if (trimmed.length < 16) {
    return { valid: false, reason: 'Cloudflare API Token quá ngắn (cần tối thiểu 16 ký tự).' };
  }
  if (trimmed.length > 512) {
    return { valid: false, reason: 'Cloudflare API Token quá dài (tối đa 512 ký tự).' };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'Cloudflare API Token không được chứa khoảng trắng hoặc xuống dòng.' };
  }
  return { valid: true };
}

let cachedMistralKey: CachedSingleKey | null = null;
let cachedGroqKey: CachedSingleKey | null = null;
let cachedCloudflareCreds: CachedCloudflareCredentials | null = null;

function writeEncryptedSecretFiles(
  primaryFile: string,
  tmpFile: string,
  record: StoredEncryptedSecret
): void {
  const serialized = JSON.stringify(record, null, 2);
  if (process.env.VERCEL !== '1') {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(primaryFile, serialized, { mode: 0o600 });
    } catch {
      // Fallback to os.tmpdir() on read-only serverless containers
    }
  }
  try {
    fs.writeFileSync(tmpFile, serialized, { mode: 0o600 });
  } catch {
    // Ignore if tmpdir unavailable
  }
}

function removeEncryptedSecretFiles(primaryFile: string, tmpFile: string): void {
  for (const filePath of [primaryFile, tmpFile]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

function readLocalEncryptedRecord(primaryFile: string, tmpFile: string): StoredEncryptedSecret | null {
  for (const filePath of [primaryFile, tmpFile]) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoredEncryptedSecret;
      if (!parsed.ciphertext || !parsed.iv || !parsed.authTag) continue;
      return parsed;
    } catch {
      // Ignore corrupted local cache
    }
  }
  return null;
}

function parseStoredCloudflareDoc(doc: StoredEncryptedSecret): CachedCloudflareCredentials | null {
  try {
    const rawJson = decryptSecretPayload(doc);
    const parsed = JSON.parse(rawJson) as { accountId?: string; apiToken?: string };
    const accountId = (parsed.accountId || '').trim();
    const apiToken = (parsed.apiToken || '').trim();
    if (!accountId || !apiToken) return null;
    const maskedAccountId = maskCompactSecret(accountId);
    const maskedKey = maskApiKey(apiToken);
    return {
      accountId,
      apiToken,
      maskedAccountId,
      maskedKey,
      maskedIdentifier: doc.maskedIdentifier || maskCloudflareIdentifier(accountId, apiToken),
      label: doc.label || 'Cloudflare Workers AI Free',
      updatedAt: doc.updatedAt || new Date().toISOString(),
      updatedBy: doc.updatedBy || 'admin',
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage,
    };
  } catch {
    return null;
  }
}

function loadLocalEncryptedFiles(): void {
  const mistralDoc = readLocalEncryptedRecord(
    MISTRAL_ENCRYPTED_KEY_FILE,
    TMP_MISTRAL_ENCRYPTED_KEY_FILE
  );
  if (mistralDoc) {
    try {
      const rawKey = decryptSecretPayload(mistralDoc);
      if (rawKey) {
        cachedMistralKey = {
          rawKey,
          maskedKey: mistralDoc.maskedIdentifier || maskApiKey(rawKey),
          label: mistralDoc.label || 'Mistral AI Free API Key',
          updatedAt: mistralDoc.updatedAt || new Date().toISOString(),
          updatedBy: mistralDoc.updatedBy || 'admin',
          lastTestStatus: mistralDoc.lastTestStatus,
          lastTestAt: mistralDoc.lastTestAt,
          lastTestMessage: mistralDoc.lastTestMessage,
        };
      }
    } catch {
      cachedMistralKey = null;
    }
  }

  const groqDoc = readLocalEncryptedRecord(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE);
  if (groqDoc) {
    try {
      const rawKey = decryptSecretPayload(groqDoc);
      if (rawKey) {
        cachedGroqKey = {
          rawKey,
          maskedKey: groqDoc.maskedIdentifier || maskApiKey(rawKey),
          label: groqDoc.label || 'Groq Cloud Free API Key',
          updatedAt: groqDoc.updatedAt || new Date().toISOString(),
          updatedBy: groqDoc.updatedBy || 'admin',
          lastTestStatus: groqDoc.lastTestStatus,
          lastTestAt: groqDoc.lastTestAt,
          lastTestMessage: groqDoc.lastTestMessage,
        };
      }
    } catch {
      cachedGroqKey = null;
    }
  }

  const cfDoc = readLocalEncryptedRecord(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE);
  if (cfDoc) {
    cachedCloudflareCreds = parseStoredCloudflareDoc(cfDoc);
  }
}

// Hydrate immediately on backend boot if previously saved locally
loadLocalEncryptedFiles();

function getEnvFallbackMistralKey(): string | null {
  const candidates = [
    process.env.MISTRAL_API_KEY,
    process.env.MISTRAL_API_KEY_1,
    process.env.MISTRAL_KEY_CHAM_1,
    process.env.MISTRAL_KEY_QUET_1,
    process.env.MISTRAL_KEY_DO_1,
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean && clean !== 'YOUR_MISTRAL_API_KEY') return clean;
  }
  return null;
}

function getEnvFallbackGroqKey(): string | null {
  const candidates = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_KEY_QUET_1,
    process.env.GROQ_KEY_DO_1,
    process.env.GROQ_KEY_CHAM_1,
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean) return clean;
  }
  return null;
}

function getEnvFallbackCloudflareCredentials(): { accountId: string; apiToken: string } | null {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || '').trim();
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

async function hydrateMistralSecretFromFirestore(idToken: string): Promise<void> {
  if (cachedMistralKey) return;
  try {
    const doc = await firestoreRestGet<StoredEncryptedSecret>(FIRESTORE_MISTRAL_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptSecretPayload(doc);
    if (!rawKey) return;
    cachedMistralKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || 'Mistral AI Free API Key',
      updatedAt: doc.updatedAt || new Date().toISOString(),
      updatedBy: doc.updatedBy || 'admin',
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage,
    };
    writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, doc);
  } catch {
    // Ignore if doc does not exist yet or key seed rotated
  }
}

async function hydrateGroqSecretFromFirestore(idToken: string): Promise<void> {
  if (cachedGroqKey) return;
  try {
    const doc = await firestoreRestGet<StoredEncryptedSecret>(FIRESTORE_GROQ_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptSecretPayload(doc);
    if (!rawKey) return;
    cachedGroqKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || 'Groq Cloud Free API Key',
      updatedAt: doc.updatedAt || new Date().toISOString(),
      updatedBy: doc.updatedBy || 'admin',
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage,
    };
    writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, doc);
  } catch {
    // Ignore if doc does not exist yet
  }
}

async function hydrateCloudflareSecretFromFirestore(idToken: string): Promise<void> {
  if (cachedCloudflareCreds) return;
  try {
    const doc = await firestoreRestGet<StoredEncryptedSecret>(FIRESTORE_CF_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const parsed = parseStoredCloudflareDoc(doc);
    if (!parsed) return;
    cachedCloudflareCreds = parsed;
    writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, doc);
  } catch {
    // Ignore if doc does not exist yet
  }
}

/**
 * Hydrates all encrypted Admin provider API keys (`mistral`, `groq`, `cloudflare`) from Firestore
 * in parallel after a serverless cold start so verified users immediately benefit from Admin keys.
 */
export async function hydrateAllProviderKeysFromFirestore(idToken: string): Promise<void> {
  if (!idToken) return;
  await Promise.allSettled([
    hydrateMistralSecretFromFirestore(idToken),
    hydrateGroqSecretFromFirestore(idToken),
    hydrateCloudflareSecretFromFirestore(idToken),
  ]);
}

export async function hydrateSingleKeyForSuperAdmin(idToken: string): Promise<void> {
  await hydrateAllProviderKeysFromFirestore(idToken);
}

export const hydrateSingleKeyFromFirestore = hydrateSingleKeyForSuperAdmin;

export async function getMistralKeyStatus(idToken?: string): Promise<SingleApiKeyStatus> {
  if (idToken && !cachedMistralKey) {
    await hydrateMistralSecretFromFirestore(idToken);
  }

  const hasEnvFallbackKey = Boolean(getEnvFallbackMistralKey());

  if (cachedMistralKey) {
    return {
      configured: true,
      source: 'admin',
      maskedKey: cachedMistralKey.maskedKey,
      label: cachedMistralKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedMistralKey.lastTestStatus || 'Untested',
      lastTestAt: cachedMistralKey.lastTestAt,
      lastTestMessage: cachedMistralKey.lastTestMessage,
      updatedAt: cachedMistralKey.updatedAt,
      updatedBy: cachedMistralKey.updatedBy,
    };
  }

  const envKey = getEnvFallbackMistralKey();
  if (envKey) {
    return {
      configured: true,
      source: 'server_env',
      maskedKey: maskApiKey(envKey),
      label: 'Biến môi trường máy chủ (MISTRAL_API_KEY)',
      hasEnvFallbackKey: true,
      lastTestStatus: 'Untested',
    };
  }

  return {
    configured: false,
    source: 'none',
    maskedKey: '',
    label: '',
    hasEnvFallbackKey: false,
    lastTestStatus: 'Untested',
  };
}

export async function getGroqKeyStatus(idToken?: string): Promise<SingleApiKeyStatus> {
  if (idToken && !cachedGroqKey) {
    await hydrateGroqSecretFromFirestore(idToken);
  }

  const hasEnvFallbackKey = Boolean(getEnvFallbackGroqKey());

  if (cachedGroqKey) {
    return {
      configured: true,
      source: 'admin',
      maskedKey: cachedGroqKey.maskedKey,
      label: cachedGroqKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedGroqKey.lastTestStatus || 'Untested',
      lastTestAt: cachedGroqKey.lastTestAt,
      lastTestMessage: cachedGroqKey.lastTestMessage,
      updatedAt: cachedGroqKey.updatedAt,
      updatedBy: cachedGroqKey.updatedBy,
    };
  }

  const envKey = getEnvFallbackGroqKey();
  if (envKey) {
    return {
      configured: true,
      source: 'server_env',
      maskedKey: maskApiKey(envKey),
      label: 'Biến môi trường máy chủ (GROQ_API_KEY)',
      hasEnvFallbackKey: true,
      lastTestStatus: 'Untested',
    };
  }

  return {
    configured: false,
    source: 'none',
    maskedKey: '',
    label: '',
    hasEnvFallbackKey: false,
    lastTestStatus: 'Untested',
  };
}

export async function getCloudflareKeyStatus(idToken?: string): Promise<CloudflareKeyStatus> {
  if (idToken && !cachedCloudflareCreds) {
    await hydrateCloudflareSecretFromFirestore(idToken);
  }

  const envCreds = getEnvFallbackCloudflareCredentials();
  const hasEnvFallbackKey = Boolean(envCreds);

  if (cachedCloudflareCreds) {
    return {
      configured: true,
      source: 'admin',
      maskedAccountId: cachedCloudflareCreds.maskedAccountId,
      maskedKey: cachedCloudflareCreds.maskedKey,
      label: cachedCloudflareCreds.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedCloudflareCreds.lastTestStatus || 'Untested',
      lastTestAt: cachedCloudflareCreds.lastTestAt,
      lastTestMessage: cachedCloudflareCreds.lastTestMessage,
      updatedAt: cachedCloudflareCreds.updatedAt,
      updatedBy: cachedCloudflareCreds.updatedBy,
    };
  }

  if (envCreds) {
    return {
      configured: true,
      source: 'server_env',
      maskedAccountId: maskCompactSecret(envCreds.accountId),
      maskedKey: maskApiKey(envCreds.apiToken),
      label: 'Biến môi trường máy chủ (CLOUDFLARE_ACCOUNT_ID / TOKEN)',
      hasEnvFallbackKey: true,
      lastTestStatus: 'Untested',
    };
  }

  return {
    configured: false,
    source: 'none',
    maskedAccountId: '',
    maskedKey: '',
    label: '',
    hasEnvFallbackKey: false,
    lastTestStatus: 'Untested',
  };
}

export async function getProviderKeysStatus(idToken?: string): Promise<ProviderKeysStatus> {
  const [mistral, groq, cloudflare] = await Promise.all([
    getMistralKeyStatus(idToken),
    getGroqKeyStatus(idToken),
    getCloudflareKeyStatus(idToken),
  ]);
  return { mistral, groq, cloudflare };
}

export async function setMistralApiKey(params: {
  rawKey: string;
  label?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: SingleApiKeyStatus } | { ok: false; error: string }> {
  const { rawKey, label, actorUid, actorEmail, idToken } = params;
  const trimmed = rawKey.trim();
  const check = validateApiKeyInput(trimmed);
  if (!check.valid) {
    return { ok: false, error: check.reason || 'Mistral API key không hợp lệ.' };
  }

  const now = new Date().toISOString();
  const maskedIdentifier = maskApiKey(trimmed).slice(0, 40);
  const encrypted = encryptSecretPayload(trimmed);
  const finalLabel = ((label || '').trim() || 'Mistral AI Free API Key').slice(0, 100);

  const storedDoc: StoredEncryptedSecret = {
    secretId: 'mistral',
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: 'Untested',
    lastTestAt: '',
    lastTestMessage: '',
  };

  cachedMistralKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: 'Untested',
  };

  writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, storedDoc);

  try {
    await firestoreRestSet(
      FIRESTORE_MISTRAL_DOC,
      storedDoc as unknown as Record<string, unknown>,
      idToken
    );
  } catch (err) {
    console.warn('Could not persist encrypted Mistral key to Firestore:', err);
    if (process.env.VERCEL === '1') {
      return {
        ok: false,
        error:
          'Không thể lưu khóa Mistral mã hóa lên Cloud Firestore (adminSecrets/mistral). Vui lòng kiểm tra quyền Super Admin hoặc kết nối Firestore.',
      };
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'MISTRAL_API_KEY_SAVED',
      resourceType: 'adminSecrets',
      resourceId: 'mistral',
      status: 'success',
      metadata: {
        maskedIdentifier,
        label: finalLabel,
      },
    },
    idToken
  );

  return { ok: true, status: await getMistralKeyStatus() };
}

export async function clearMistralApiKey(params: {
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: SingleApiKeyStatus }> {
  const { actorUid, actorEmail, idToken } = params;
  cachedMistralKey = null;
  removeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE);

  try {
    await firestoreRestDelete(FIRESTORE_MISTRAL_DOC, idToken);
  } catch {
    // Ignore if not present in Firestore
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'MISTRAL_API_KEY_CLEARED',
      resourceType: 'adminSecrets',
      resourceId: 'mistral',
      status: 'success',
      metadata: {},
    },
    idToken
  );

  return { ok: true, status: await getMistralKeyStatus() };
}

export async function setGroqApiKey(params: {
  rawKey: string;
  label?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: SingleApiKeyStatus } | { ok: false; error: string }> {
  const { rawKey, label, actorUid, actorEmail, idToken } = params;
  const trimmed = rawKey.trim();
  const check = validateApiKeyInput(trimmed);
  if (!check.valid) {
    return { ok: false, error: check.reason || 'Groq API key không hợp lệ.' };
  }

  const now = new Date().toISOString();
  const maskedIdentifier = maskApiKey(trimmed).slice(0, 40);
  const encrypted = encryptSecretPayload(trimmed);
  const finalLabel = ((label || '').trim() || 'Groq Cloud Free API Key').slice(0, 100);

  const storedDoc: StoredEncryptedSecret = {
    secretId: 'groq',
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: 'Untested',
    lastTestAt: '',
    lastTestMessage: '',
  };

  cachedGroqKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: 'Untested',
  };

  writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, storedDoc);

  try {
    await firestoreRestSet(
      FIRESTORE_GROQ_DOC,
      storedDoc as unknown as Record<string, unknown>,
      idToken
    );
  } catch (err) {
    console.warn('Could not persist encrypted Groq key to Firestore:', err);
    if (process.env.VERCEL === '1') {
      return {
        ok: false,
        error:
          'Không thể lưu khóa Groq mã hóa lên Cloud Firestore (adminSecrets/groq). Vui lòng kiểm tra quyền Super Admin hoặc kết nối Firestore.',
      };
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'GROQ_API_KEY_SAVED',
      resourceType: 'adminSecrets',
      resourceId: 'groq',
      status: 'success',
      metadata: {
        maskedIdentifier,
        label: finalLabel,
      },
    },
    idToken
  );

  return { ok: true, status: await getGroqKeyStatus() };
}

export async function clearGroqApiKey(params: {
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: SingleApiKeyStatus }> {
  const { actorUid, actorEmail, idToken } = params;
  cachedGroqKey = null;
  removeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE);

  try {
    await firestoreRestDelete(FIRESTORE_GROQ_DOC, idToken);
  } catch {
    // Ignore if not present in Firestore
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'GROQ_API_KEY_CLEARED',
      resourceType: 'adminSecrets',
      resourceId: 'groq',
      status: 'success',
      metadata: {},
    },
    idToken
  );

  return { ok: true, status: await getGroqKeyStatus() };
}

export async function setCloudflareCredentials(params: {
  accountId: string;
  apiToken: string;
  label?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: CloudflareKeyStatus } | { ok: false; error: string }> {
  const { accountId, apiToken, label, actorUid, actorEmail, idToken } = params;
  const cleanAccountId = accountId.trim();
  const cleanToken = apiToken.trim();

  const accCheck = validateCloudflareAccountId(cleanAccountId);
  if (!accCheck.valid) {
    return { ok: false, error: accCheck.reason || 'Cloudflare Account ID không hợp lệ.' };
  }
  const tokCheck = validateCloudflareToken(cleanToken);
  if (!tokCheck.valid) {
    return { ok: false, error: tokCheck.reason || 'Cloudflare API Token không hợp lệ.' };
  }

  const now = new Date().toISOString();
  const maskedAccountId = maskCompactSecret(cleanAccountId);
  const maskedKey = maskApiKey(cleanToken);
  const maskedIdentifier = maskCloudflareIdentifier(cleanAccountId, cleanToken);
  const encrypted = encryptSecretPayload(
    JSON.stringify({ accountId: cleanAccountId, apiToken: cleanToken })
  );
  const finalLabel = ((label || '').trim() || 'Cloudflare Workers AI Free').slice(0, 100);

  const storedDoc: StoredEncryptedSecret = {
    secretId: 'cloudflare',
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: 'Untested',
    lastTestAt: '',
    lastTestMessage: '',
  };

  cachedCloudflareCreds = {
    accountId: cleanAccountId,
    apiToken: cleanToken,
    maskedAccountId,
    maskedKey,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: 'Untested',
  };

  writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, storedDoc);

  try {
    await firestoreRestSet(
      FIRESTORE_CF_DOC,
      storedDoc as unknown as Record<string, unknown>,
      idToken
    );
  } catch (err) {
    console.warn('Could not persist encrypted Cloudflare credentials to Firestore:', err);
    if (process.env.VERCEL === '1') {
      return {
        ok: false,
        error:
          'Không thể lưu thông tin Cloudflare mã hóa lên Cloud Firestore (adminSecrets/cloudflare). Vui lòng kiểm tra quyền Super Admin hoặc kết nối Firestore.',
      };
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'CLOUDFLARE_CREDENTIALS_SAVED',
      resourceType: 'adminSecrets',
      resourceId: 'cloudflare',
      status: 'success',
      metadata: {
        maskedIdentifier,
        label: finalLabel,
      },
    },
    idToken
  );

  return { ok: true, status: await getCloudflareKeyStatus() };
}

export async function clearCloudflareCredentials(params: {
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: CloudflareKeyStatus }> {
  const { actorUid, actorEmail, idToken } = params;
  cachedCloudflareCreds = null;
  removeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE);

  try {
    await firestoreRestDelete(FIRESTORE_CF_DOC, idToken);
  } catch {
    // Ignore if not present in Firestore
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'CLOUDFLARE_CREDENTIALS_CLEARED',
      resourceType: 'adminSecrets',
      resourceId: 'cloudflare',
      status: 'success',
      metadata: {},
    },
    idToken
  );

  return { ok: true, status: await getCloudflareKeyStatus() };
}

export async function testMistralApiKey(params: {
  rawKeyOverride?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{
  status: KeyTestStatus;
  message: string;
  testedSource: 'admin' | 'server_env' | 'preview_input' | 'none';
  testedAt: string;
  keyStatus: SingleApiKeyStatus;
}> {
  const { rawKeyOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = new Date().toISOString();

  if (!cachedMistralKey) {
    await hydrateMistralSecretFromFirestore(idToken);
  }

  let keyToTest = '';
  let testedSource: 'admin' | 'server_env' | 'preview_input' | 'none' = 'none';

  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = 'preview_input';
  } else if (cachedMistralKey) {
    keyToTest = cachedMistralKey.rawKey;
    testedSource = 'admin';
  } else {
    const envKey = getEnvFallbackMistralKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = 'server_env';
    }
  }

  if (!keyToTest) {
    return {
      status: 'Invalid key',
      message: 'Chưa cấu hình Mistral AI API Key. Hãy dán key rồi bấm Lưu hoặc Thử nghiệm.',
      testedSource: 'none',
      testedAt,
      keyStatus: await getMistralKeyStatus(),
    };
  }

  let resultStatus: KeyTestStatus = 'Connected';
  const testModel = 'mistral-small-latest';
  let resultMessage = `Kết nối Mistral AI thành công (model ${testModel} phản hồi tốt).`;

  try {
    const pingRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${keyToTest}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'Trả lời duy nhất 1 từ: OK' }],
        temperature: 0,
        max_tokens: 32,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!pingRes.ok) {
      const errText = await pingRes.text().catch(() => '');
      if (pingRes.status === 402) {
        resultStatus = 'Quota exceeded';
        resultMessage =
          'Mistral báo HTTP 402 (Cần kích hoạt gói): Key miễn phí của Mistral vẫn cần vào console.mistral.ai → Billing / Subscription để chọn gói Experiment (miễn phí, xác minh SĐT) hoặc nạp credit. Trong lúc chờ, hệ thống sẽ tự chuyển sang Groq / Cloudflare nếu đã cấu hình.';
      } else if (pingRes.status === 401 || pingRes.status === 403) {
        resultStatus = 'Invalid key';
        resultMessage = 'Mistral AI API Key không hợp lệ hoặc đã bị thu hồi.';
      } else if (pingRes.status === 429) {
        resultStatus = 'Quota exceeded';
        resultMessage = 'Mistral AI API Key đã chạm hạn mức (429).';
      } else if (pingRes.status === 404) {
        resultStatus = 'Model unavailable';
        resultMessage = `Model ${testModel} không khả dụng trên tài khoản Mistral này.`;
      } else {
        resultStatus = 'Temporary provider error';
        resultMessage = `Lỗi Mistral AI (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
      }
    }
  } catch (err) {
    resultStatus = 'Temporary provider error';
    resultMessage = `Lỗi kết nối Mistral AI: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }

  if (testedSource === 'preview_input' && resultStatus === 'Connected') {
    const check = validateApiKeyInput(keyToTest);
    if (check.valid) {
      await setMistralApiKey({
        rawKey: keyToTest,
        label: cachedMistralKey?.label || 'Mistral AI Free API Key',
        actorUid,
        actorEmail,
        idToken,
      });
      resultMessage = `${resultMessage} Đã tự động lưu và kích hoạt khóa Mistral AI cho Kiểm định.`;
    }
  }

  if (
    (testedSource === 'admin' || (testedSource === 'preview_input' && resultStatus === 'Connected')) &&
    cachedMistralKey
  ) {
    cachedMistralKey.lastTestStatus = resultStatus;
    cachedMistralKey.lastTestAt = testedAt;
    cachedMistralKey.lastTestMessage = resultMessage.slice(0, 280);

    const encrypted = encryptSecretPayload(cachedMistralKey.rawKey);
    const updatedDoc: StoredEncryptedSecret = {
      secretId: 'mistral',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedMistralKey.maskedKey.slice(0, 40),
      label: cachedMistralKey.label.slice(0, 100),
      updatedAt: cachedMistralKey.updatedAt,
      updatedBy: cachedMistralKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedMistralKey.lastTestMessage,
    };
    writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_MISTRAL_DOC,
        updatedDoc as unknown as Record<string, unknown>,
        idToken
      );
    } catch {
      // Non-fatal
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'MISTRAL_API_KEY_TESTED',
      resourceType: 'adminSecrets',
      resourceId: 'mistral',
      status: resultStatus === 'Connected' ? 'success' : 'failure',
      metadata: {
        resultStatus,
        testedSource,
      },
    },
    idToken
  );

  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getMistralKeyStatus(),
  };
}

export async function testGroqApiKey(params: {
  rawKeyOverride?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{
  status: KeyTestStatus;
  message: string;
  testedSource: 'admin' | 'server_env' | 'preview_input' | 'none';
  testedAt: string;
  keyStatus: SingleApiKeyStatus;
  availableModels?: string[];
}> {
  const { rawKeyOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = new Date().toISOString();

  if (!cachedGroqKey) {
    await hydrateGroqSecretFromFirestore(idToken);
  }

  let keyToTest = '';
  let testedSource: 'admin' | 'server_env' | 'preview_input' | 'none' = 'none';

  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = 'preview_input';
  } else if (cachedGroqKey) {
    keyToTest = cachedGroqKey.rawKey;
    testedSource = 'admin';
  } else {
    const envKey = getEnvFallbackGroqKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = 'server_env';
    }
  }

  if (!keyToTest) {
    return {
      status: 'Invalid key',
      message: 'Chưa cấu hình Groq API Key. Hãy dán key (gsk_...) rồi bấm Lưu hoặc Thử nghiệm.',
      testedSource: 'none',
      testedAt,
      keyStatus: await getGroqKeyStatus(),
    };
  }

  let resultStatus: KeyTestStatus = 'Connected';
  let resultMessage = '';
  let availableModels: string[] = [];

  try {
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${keyToTest}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (modelsRes.status === 401 || modelsRes.status === 403) {
      resultStatus = 'Invalid key';
      resultMessage = 'Groq API Key không hợp lệ hoặc đã bị thu hồi.';
    } else if (modelsRes.status === 429) {
      resultStatus = 'Quota exceeded';
      resultMessage = 'Tài khoản Groq đang chạm hạn mức (429).';
    } else if (!modelsRes.ok) {
      resultStatus = 'Temporary provider error';
      resultMessage = `Groq API phản hồi HTTP ${modelsRes.status}.`;
    } else {
      const modelsData = (await modelsRes.json()) as {
        data?: Array<{ id?: string; active?: boolean }>;
      };
      const excluded = ['whisper', 'tts', 'playai', 'guard', 'safeguard', 'orpheus', 'compound'];
      availableModels = (modelsData.data || [])
        .filter((m) => m && typeof m.id === 'string' && m.active !== false)
        .map((m) => m.id!.trim())
        .filter((id) => !excluded.some((tok) => id.toLowerCase().includes(tok)));

      const preferred = [
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'qwen/qwen3.8-27b',
        'qwen/qwen3-32b',
      ];
      const availableVisionModels = availableModels.filter((m) => isGroqVisionModelId(m));
      const chosenModel =
        preferred.find((p) => availableModels.some((m) => m.toLowerCase() === p)) ||
        availableModels[0] ||
        'openai/gpt-oss-120b';

      const pingRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${keyToTest}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: chosenModel,
          messages: [{ role: 'user', content: 'Trả lời duy nhất 1 từ: OK' }],
          temperature: 0.1,
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (pingRes.ok) {
        resultStatus = 'Connected';
        const visionStatusText =
          availableVisionModels.length > 0
            ? `Vision OCR sẵn sàng: ${availableVisionModels.slice(0, 2).join(', ')}`
            : 'Chưa thấy model Vision OCR trên key Groq này — hệ thống sẽ dùng Cloudflare Workers AI hoặc Mistral AI để đọc ảnh';
        resultMessage = `Kết nối Groq Cloud thành công (model ${chosenModel} phản hồi tốt; ${availableModels.length} model khả dụng; ${visionStatusText}).`;
      } else {
        const errText = await pingRes.text().catch(() => '');
        if (pingRes.status === 401 || pingRes.status === 403) {
          resultStatus = 'Invalid key';
          resultMessage = 'Groq API Key không có quyền gọi chat completion.';
        } else if (pingRes.status === 429) {
          resultStatus = 'Quota exceeded';
          resultMessage = 'Groq API Key đã chạm hạn mức (429).';
        } else if (pingRes.status === 404) {
          resultStatus = 'Model unavailable';
          resultMessage = `Model ${chosenModel} không khả dụng trên tài khoản Groq này.`;
        } else {
          resultStatus = 'Temporary provider error';
          resultMessage = `Lỗi Groq (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
        }
      }
    }
  } catch (err) {
    resultStatus = 'Temporary provider error';
    resultMessage = `Lỗi kết nối Groq Cloud: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }

  if (testedSource === 'preview_input' && resultStatus === 'Connected') {
    const check = validateApiKeyInput(keyToTest);
    if (check.valid) {
      await setGroqApiKey({
        rawKey: keyToTest,
        label: cachedGroqKey?.label || 'Groq Cloud Free API Key',
        actorUid,
        actorEmail,
        idToken,
      });
      resultMessage = `${resultMessage} Đã tự động lưu và kích hoạt khóa Groq này cho Kiểm định.`;
    }
  }

  if (
    (testedSource === 'admin' || (testedSource === 'preview_input' && resultStatus === 'Connected')) &&
    cachedGroqKey
  ) {
    cachedGroqKey.lastTestStatus = resultStatus;
    cachedGroqKey.lastTestAt = testedAt;
    cachedGroqKey.lastTestMessage = resultMessage.slice(0, 280);

    const encrypted = encryptSecretPayload(cachedGroqKey.rawKey);
    const updatedDoc: StoredEncryptedSecret = {
      secretId: 'groq',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedGroqKey.maskedKey.slice(0, 40),
      label: cachedGroqKey.label.slice(0, 100),
      updatedAt: cachedGroqKey.updatedAt,
      updatedBy: cachedGroqKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedGroqKey.lastTestMessage,
    };
    writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_GROQ_DOC,
        updatedDoc as unknown as Record<string, unknown>,
        idToken
      );
    } catch {
      // Non-fatal
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'GROQ_API_KEY_TESTED',
      resourceType: 'adminSecrets',
      resourceId: 'groq',
      status: resultStatus === 'Connected' ? 'success' : 'failure',
      metadata: {
        resultStatus,
        testedSource,
      },
    },
    idToken
  );

  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getGroqKeyStatus(),
    availableModels: availableModels.slice(0, 10),
  };
}

export async function testCloudflareCredentials(params: {
  accountIdOverride?: string;
  apiTokenOverride?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{
  status: KeyTestStatus;
  message: string;
  testedSource: 'admin' | 'server_env' | 'preview_input' | 'none';
  testedAt: string;
  keyStatus: CloudflareKeyStatus;
}> {
  const { accountIdOverride, apiTokenOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = new Date().toISOString();

  if (!cachedCloudflareCreds) {
    await hydrateCloudflareSecretFromFirestore(idToken);
  }

  let accountId = '';
  let apiToken = '';
  let testedSource: 'admin' | 'server_env' | 'preview_input' | 'none' = 'none';

  if (accountIdOverride?.trim() || apiTokenOverride?.trim()) {
    accountId = (accountIdOverride || '').trim() || cachedCloudflareCreds?.accountId || '';
    apiToken = (apiTokenOverride || '').trim() || cachedCloudflareCreds?.apiToken || '';
    testedSource = 'preview_input';
  } else if (cachedCloudflareCreds) {
    accountId = cachedCloudflareCreds.accountId;
    apiToken = cachedCloudflareCreds.apiToken;
    testedSource = 'admin';
  } else {
    const envCreds = getEnvFallbackCloudflareCredentials();
    if (envCreds) {
      accountId = envCreds.accountId;
      apiToken = envCreds.apiToken;
      testedSource = 'server_env';
    }
  }

  if (!accountId || !apiToken) {
    return {
      status: 'Invalid key',
      message:
        'Chưa đủ thông tin Cloudflare Workers AI (cần cả Account ID và API Token). Hãy điền đủ 2 trường rồi bấm Lưu hoặc Thử nghiệm.',
      testedSource: 'none',
      testedAt,
      keyStatus: await getCloudflareKeyStatus(),
    };
  }

  const accCheck = validateCloudflareAccountId(accountId);
  if (!accCheck.valid) {
    return {
      status: 'Invalid key',
      message: accCheck.reason || 'Cloudflare Account ID không hợp lệ.',
      testedSource,
      testedAt,
      keyStatus: await getCloudflareKeyStatus(),
    };
  }

  let resultStatus: KeyTestStatus = 'Connected';
  const testModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  let resultMessage = `Kết nối Cloudflare Workers AI thành công (${testModel} phản hồi tốt).`;

  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
    const pingRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'Trả lời duy nhất 1 từ: OK' }],
        temperature: 0.1,
        max_tokens: 128,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!pingRes.ok) {
      const errText = await pingRes.text().catch(() => '');
      if (pingRes.status === 401 || pingRes.status === 403) {
        resultStatus = 'Permission denied';
        resultMessage =
          'Cloudflare Account ID hoặc API Token không hợp lệ (hãy đảm bảo token có quyền Workers AI Read/Edit).';
      } else if (pingRes.status === 429) {
        resultStatus = 'Quota exceeded';
        resultMessage = 'Tài khoản Cloudflare Workers AI đã chạm giới hạn 10.000 Neurons/ngày (429).';
      } else if (pingRes.status === 404) {
        resultStatus = 'Model unavailable';
        resultMessage = 'Account ID không tồn tại hoặc model Cloudflare không khả dụng.';
      } else {
        resultStatus = 'Temporary provider error';
        resultMessage = `Lỗi Cloudflare Workers AI (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
      }
    }
  } catch (err) {
    resultStatus = 'Temporary provider error';
    resultMessage = `Lỗi kết nối Cloudflare Workers AI: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }

  if (testedSource === 'preview_input' && resultStatus === 'Connected') {
    const tokCheck = validateCloudflareToken(apiToken);
    if (tokCheck.valid) {
      await setCloudflareCredentials({
        accountId,
        apiToken,
        label: cachedCloudflareCreds?.label || 'Cloudflare Workers AI Free',
        actorUid,
        actorEmail,
        idToken,
      });
      resultMessage = `${resultMessage} Đã tự động lưu và kích hoạt Cloudflare Workers AI cho Kiểm định.`;
    }
  }

  if (
    (testedSource === 'admin' || (testedSource === 'preview_input' && resultStatus === 'Connected')) &&
    cachedCloudflareCreds
  ) {
    cachedCloudflareCreds.lastTestStatus = resultStatus;
    cachedCloudflareCreds.lastTestAt = testedAt;
    cachedCloudflareCreds.lastTestMessage = resultMessage.slice(0, 280);

    const encrypted = encryptSecretPayload(
      JSON.stringify({
        accountId: cachedCloudflareCreds.accountId,
        apiToken: cachedCloudflareCreds.apiToken,
      })
    );
    const updatedDoc: StoredEncryptedSecret = {
      secretId: 'cloudflare',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedCloudflareCreds.maskedIdentifier.slice(0, 40),
      label: cachedCloudflareCreds.label.slice(0, 100),
      updatedAt: cachedCloudflareCreds.updatedAt,
      updatedBy: cachedCloudflareCreds.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedCloudflareCreds.lastTestMessage,
    };
    writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_CF_DOC,
        updatedDoc as unknown as Record<string, unknown>,
        idToken
      );
    } catch {
      // Non-fatal
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'CLOUDFLARE_CREDENTIALS_TESTED',
      resourceType: 'adminSecrets',
      resourceId: 'cloudflare',
      status: resultStatus === 'Connected' ? 'success' : 'failure',
      metadata: {
        resultStatus,
        testedSource,
      },
    },
    idToken
  );

  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getCloudflareKeyStatus(),
  };
}

/**
 * Resolves the active Mistral AI API Key synchronously (Admin in-web key first, env fallback).
 */
export function getActiveMistralApiKeySync(): string {
  if (cachedMistralKey?.rawKey) {
    return cachedMistralKey.rawKey;
  }
  return getEnvFallbackMistralKey() || '';
}

export function resolveActiveMistralApiKey(): string {
  return getActiveMistralApiKeySync();
}

export function isMistralKeyConfigured(): boolean {
  return getActiveMistralApiKeySync().length > 0;
}

/**
 * Resolves the active Groq Cloud API Key (Admin in-web key first, GROQ_API_KEY env fallback).
 */
export function resolveActiveGroqApiKey(): string {
  if (cachedGroqKey?.rawKey) {
    return cachedGroqKey.rawKey;
  }
  return getEnvFallbackGroqKey() || '';
}

/**
 * Resolves the active Cloudflare Workers AI credentials (Admin in-web creds first, env fallback).
 */
export function resolveActiveCloudflareCredentials(): { accountId: string; apiToken: string } {
  if (cachedCloudflareCreds?.accountId && cachedCloudflareCreds?.apiToken) {
    return {
      accountId: cachedCloudflareCreds.accountId,
      apiToken: cachedCloudflareCreds.apiToken,
    };
  }
  return getEnvFallbackCloudflareCredentials() || { accountId: '', apiToken: '' };
}

/**
 * Resolve optional scoped per-stage & slot API key (e.g., GROQ_KEY_QUET_1, MISTRAL_KEY_CHAM_1, KEY_DO_1)
 * falling back cleanly to the active Admin / Server Env provider key.
 */
export function resolveScopedApiKeyForStage(
  provider: 'groq' | 'mistral',
  stage: AdaptiveStageCode,
  slot: AdaptiveSlotNumber
): string | undefined {
  const defaultKey =
    provider === 'groq' ? resolveActiveGroqApiKey() : resolveActiveMistralApiKey();
  const resolved = resolveScopedStageApiKey({
    provider,
    stage,
    slot,
    env: process.env,
    defaultKey,
  });
  return resolved || undefined;
}

export function getColdStartEnvTemplate(): string {
  return [
    '# Biến môi trường cốt lõi cho kiến trúc 3 nhà cung cấp miễn phí 24/7 (Mistral + Cloudflare + Groq)',
    'MISTRAL_API_KEY=',
    'GROQ_API_KEY=',
    'CLOUDFLARE_ACCOUNT_ID=',
    'CLOUDFLARE_API_TOKEN=',
    '# Khóa bí mật ngẫu nhiên (tối thiểu 32 ký tự) để giữ khóa nhập trên Admin UI không bị mất sau restart',
    'KEY_ENCRYPTION_SECRET=',
    '# Tên miền web production của bạn (nếu frontend và backend khác domain)',
    'ALLOWED_ORIGIN=',
    '# Tùy chọn: Khóa chuyên biệt theo từng giai đoạn Quét (QUET), Chấm (CHAM), Đối soát (DO) cho văn bản dài',
    '# GROQ_KEY_QUET_1=',
    '# MISTRAL_KEY_CHAM_1=',
    '# GROQ_KEY_DO_1=',
    '# GROQ_KEY_DO_2=',
  ].join('\n');
}

export function detectProviderFromModelId(modelId: string): AiProviderId {
  const lower = (modelId || '').trim().toLowerCase();
  if (lower.startsWith('groq:')) return 'groq';
  if (lower.startsWith('cf:') || lower.startsWith('cloudflare:') || lower.startsWith('@cf/')) {
    return 'cloudflare';
  }
  return 'mistral';
}

export interface ColdStartReadinessInput {
  activeModel: string;
  runtimePlatform: 'vercel' | 'render' | 'standard';
  encryptionSecretConfigured: boolean;
  mistralEnvConfigured: boolean;
  mistralAdminOverrideActive: boolean;
  groqEnvConfigured: boolean;
  groqAdminOverrideActive: boolean;
  cloudflareEnvConfigured: boolean;
  cloudflareAdminOverrideActive: boolean;
}

export function buildColdStartReadinessReport(
  input: ColdStartReadinessInput
): ColdStartReadinessReport {
  const activeProvider = detectProviderFromModelId(input.activeModel);

  const mistral: ColdStartProviderReadiness = {
    provider: 'mistral',
    label: 'Mistral AI Free',
    envVarNames: ['MISTRAL_API_KEY'],
    envConfigured: input.mistralEnvConfigured,
    adminOverrideActive: input.mistralAdminOverrideActive,
    configuredNow: input.mistralEnvConfigured || input.mistralAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.mistralEnvConfigured,
  };

  const groq: ColdStartProviderReadiness = {
    provider: 'groq',
    label: 'Groq Cloud Free',
    envVarNames: ['GROQ_API_KEY'],
    envConfigured: input.groqEnvConfigured,
    adminOverrideActive: input.groqAdminOverrideActive,
    configuredNow: input.groqEnvConfigured || input.groqAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.groqEnvConfigured,
  };

  const cloudflare: ColdStartProviderReadiness = {
    provider: 'cloudflare',
    label: 'Cloudflare Workers AI',
    envVarNames: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    envConfigured: input.cloudflareEnvConfigured,
    adminOverrideActive: input.cloudflareAdminOverrideActive,
    configuredNow: input.cloudflareEnvConfigured || input.cloudflareAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.cloudflareEnvConfigured,
  };

  const providers = { mistral, groq, cloudflare };
  const activeProviderInfo = providers[activeProvider];
  const activeModelCoveredByEnv = activeProviderInfo.envConfigured;
  const anyProviderCoveredByEnv =
    mistral.envConfigured || groq.envConfigured || cloudflare.envConfigured;

  const warnings: string[] = [];

  if (!anyProviderCoveredByEnv) {
    warnings.push(
      'Chưa có API key nào trong biến môi trường máy chủ (MISTRAL_API_KEY / GROQ_API_KEY / CLOUDFLARE_*). Khi Vercel hoặc Render tự ngủ và khởi động lại lúc Admin ngoại tuyến, học sinh sẽ gặp lỗi 503.'
    );
  } else if (!activeModelCoveredByEnv) {
    warnings.push(
      `Model mặc định đang chọn (${activeProviderInfo.label}) chưa có biến môi trường ${activeProviderInfo.envVarNames.join(' / ')} trên máy chủ. Khi server reset lúc Admin ngoại tuyến, hệ thống sẽ tự chuyển sang nhà cung cấp dự phòng.`
    );
  }

  if (!input.encryptionSecretConfigured) {
    warnings.push(
      'Chưa cấu hình KEY_ENCRYPTION_SECRET trên máy chủ. Mọi API key dán trực tiếp trong trang Admin chỉ có tác dụng tạm thời trong RAM và sẽ không giải mã được sau khi server khởi động lại.'
    );
  }

  const anyAdminOnlyWithoutEnv =
    (mistral.adminOverrideActive && !mistral.envConfigured) ||
    (groq.adminOverrideActive && !groq.envConfigured) ||
    (cloudflare.adminOverrideActive && !cloudflare.envConfigured);

  if (anyAdminOnlyWithoutEnv && anyProviderCoveredByEnv) {
    const missingEnvLabels = [mistral, groq, cloudflare]
      .filter((p) => p.adminOverrideActive && !p.envConfigured)
      .map((p) => `${p.label} (${p.envVarNames.join(' + ')})`);
    warnings.push(
      `Các khóa đang dán trong Admin nhưng chưa có biến môi trường dự phòng trên server: ${missingEnvLabels.join(', ')}.`
    );
  }

  let overallStatus: ColdStartReadinessReport['overallStatus'] = 'ready_24_7';
  if (!anyProviderCoveredByEnv) {
    overallStatus = 'at_risk';
  } else if (!activeModelCoveredByEnv || !input.encryptionSecretConfigured) {
    overallStatus = 'partial_risk';
  }

  return {
    overallStatus,
    runtimePlatform: input.runtimePlatform,
    activeModel: input.activeModel,
    activeProvider,
    activeModelCoveredByEnv,
    anyProviderCoveredByEnv,
    encryptionSecretConfigured: input.encryptionSecretConfigured,
    providers,
    warnings,
    envTemplate: getColdStartEnvTemplate(),
  };
}

export function evaluateColdStartReadiness(activeModel: string): ColdStartReadinessReport {
  const runtimePlatform: ColdStartReadinessReport['runtimePlatform'] =
    process.env.VERCEL === '1'
      ? 'vercel'
      : process.env.RENDER === 'true' || Boolean(process.env.RENDER_SERVICE_ID)
        ? 'render'
        : 'standard';

  return buildColdStartReadinessReport({
    activeModel,
    runtimePlatform,
    encryptionSecretConfigured: isPersistentEncryptionSecretConfigured(),
    mistralEnvConfigured: Boolean(getEnvFallbackMistralKey()),
    mistralAdminOverrideActive: Boolean(cachedMistralKey?.rawKey),
    groqEnvConfigured: Boolean(getEnvFallbackGroqKey()),
    groqAdminOverrideActive: Boolean(cachedGroqKey?.rawKey),
    cloudflareEnvConfigured: Boolean(getEnvFallbackCloudflareCredentials()),
    cloudflareAdminOverrideActive: Boolean(
      cachedCloudflareCreds?.accountId && cachedCloudflareCreds?.apiToken
    ),
  });
}
