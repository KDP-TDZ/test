import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { KeyTestStatus, SingleApiKeyStatus } from '../core/types';
import {
  firebaseConfig,
  firestoreRestDelete,
  firestoreRestGet,
  firestoreRestSet,
} from './firebaseServer';
import { recordAuditLog } from './aiGuardService';

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

const DATA_DIR = path.resolve(process.cwd(), '.data');
const ENCRYPTED_KEY_FILE = path.join(DATA_DIR, 'single-gemini-key.enc');
const TMP_ENCRYPTED_KEY_FILE = path.join(os.tmpdir(), 'studycheck-single-gemini-key.enc');
const FIRESTORE_SECRET_DOC = 'adminSecrets/primary';

function deriveAesKey(): Buffer {
  const seed =
    process.env.KEY_ENCRYPTION_SECRET ||
    `${firebaseConfig.projectId}:${firebaseConfig.apiKey}:studycheck-single-key-v1`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptApiKey(rawKey: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptApiKey(payload: { ciphertext: string; iv: string; authTag: string }): string {
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

export function validateApiKeyInput(rawKey: string): { valid: boolean; reason?: string } {
  const trimmed = rawKey.trim();
  if (trimmed.length < 20) {
    return { valid: false, reason: 'API key quá ngắn (cần tối thiểu 20 ký tự).' };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: 'API key không được chứa khoảng trắng hoặc xuống dòng.' };
  }
  return { valid: true };
}

let cachedSingleKey: CachedSingleKey | null = null;

function writeLocalEncryptedFile(record: StoredEncryptedSecret): void {
  const serialized = JSON.stringify(record, null, 2);
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(ENCRYPTED_KEY_FILE, serialized, { mode: 0o600 });
  } catch {
    // Fallback to os.tmpdir() on read-only serverless containers (e.g. Vercel)
  }
  try {
    fs.writeFileSync(TMP_ENCRYPTED_KEY_FILE, serialized, { mode: 0o600 });
  } catch {
    // Ignore if tmpdir unavailable
  }
}

function removeLocalEncryptedFile(): void {
  for (const filePath of [ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE]) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

function loadLocalEncryptedFile(): void {
  for (const filePath of [ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE]) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoredEncryptedSecret;
      if (!parsed.ciphertext || !parsed.iv || !parsed.authTag) continue;
      const rawKey = decryptApiKey(parsed);
      if (!rawKey) continue;
      cachedSingleKey = {
        rawKey,
        maskedKey: parsed.maskedIdentifier || maskApiKey(rawKey),
        label: parsed.label || 'Gemini API Key duy nhất',
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        updatedBy: parsed.updatedBy || 'admin',
        lastTestStatus: parsed.lastTestStatus,
        lastTestAt: parsed.lastTestAt,
        lastTestMessage: parsed.lastTestMessage,
      };
      return;
    } catch {
      cachedSingleKey = null;
    }
  }
}

// Hydrate immediately on backend boot if previously saved locally
loadLocalEncryptedFile();

function getEnvFallbackKey(): string | null {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (!envKey || envKey === 'MY_GEMINI_API_KEY') return null;
  return envKey;
}

/**
 * Hydrates the single encrypted API key from Firestore (`adminSecrets/primary`)
 * when an authenticated Super Admin starts a session after a cold container restart.
 */
export async function hydrateSingleKeyForSuperAdmin(idToken: string): Promise<void> {
  if (cachedSingleKey) return;
  try {
    const doc = await firestoreRestGet<StoredEncryptedSecret>(FIRESTORE_SECRET_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptApiKey(doc);
    if (!rawKey) return;
    cachedSingleKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || 'Gemini API Key duy nhất',
      updatedAt: doc.updatedAt || new Date().toISOString(),
      updatedBy: doc.updatedBy || 'admin',
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage,
    };
    writeLocalEncryptedFile(doc);
  } catch {
    // Ignore if doc does not exist yet or key seed rotated
  }
}

export async function getSingleKeyStatus(idToken?: string): Promise<SingleApiKeyStatus> {
  if (idToken && !cachedSingleKey) {
    await hydrateSingleKeyForSuperAdmin(idToken);
  }

  const hasEnvFallbackKey = Boolean(getEnvFallbackKey());

  if (cachedSingleKey) {
    return {
      configured: true,
      source: 'admin',
      maskedKey: cachedSingleKey.maskedKey,
      label: cachedSingleKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedSingleKey.lastTestStatus || 'Untested',
      lastTestAt: cachedSingleKey.lastTestAt,
      lastTestMessage: cachedSingleKey.lastTestMessage,
      updatedAt: cachedSingleKey.updatedAt,
      updatedBy: cachedSingleKey.updatedBy,
    };
  }

  const envKey = getEnvFallbackKey();
  if (envKey) {
    return {
      configured: true,
      source: 'server_env',
      maskedKey: maskApiKey(envKey),
      label: 'Biến môi trường máy chủ (GEMINI_API_KEY)',
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

export async function setSingleGeminiApiKey(params: {
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
    return { ok: false, error: check.reason || 'API key không hợp lệ.' };
  }

  const now = new Date().toISOString();
  const maskedIdentifier = maskApiKey(trimmed);
  const encrypted = encryptApiKey(trimmed);
  const finalLabel = (label || '').trim() || 'Gemini API Key duy nhất';

  const storedDoc: StoredEncryptedSecret = {
    secretId: 'primary',
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: actorEmail || actorUid,
    lastTestStatus: 'Untested',
    lastTestAt: '',
    lastTestMessage: '',
  };

  cachedSingleKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: actorEmail || actorUid,
    lastTestStatus: 'Untested',
  };

  writeLocalEncryptedFile(storedDoc);

  try {
    await firestoreRestSet(
      FIRESTORE_SECRET_DOC,
      storedDoc as unknown as Record<string, unknown>,
      idToken
    );
  } catch (err) {
    console.warn('Could not persist encrypted key backup to Firestore:', err);
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'SINGLE_API_KEY_SAVED',
      resourceType: 'adminSecrets',
      resourceId: 'primary',
      status: 'success',
      metadata: {
        maskedIdentifier,
        label: finalLabel,
      },
    },
    idToken
  );

  return { ok: true, status: await getSingleKeyStatus() };
}

export async function clearSingleGeminiApiKey(params: {
  actorUid: string;
  actorEmail: string;
  idToken: string;
}): Promise<{ ok: true; status: SingleApiKeyStatus }> {
  const { actorUid, actorEmail, idToken } = params;
  cachedSingleKey = null;
  removeLocalEncryptedFile();

  try {
    await firestoreRestDelete(FIRESTORE_SECRET_DOC, idToken);
  } catch {
    // Ignore if not present in Firestore
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'SINGLE_API_KEY_CLEARED',
      resourceType: 'adminSecrets',
      resourceId: 'primary',
      status: 'success',
      metadata: {},
    },
    idToken
  );

  return { ok: true, status: await getSingleKeyStatus() };
}

export async function testSingleGeminiKey(params: {
  rawKeyOverride?: string;
  actorUid: string;
  actorEmail: string;
  idToken: string;
  activeModel?: string;
}): Promise<{
  status: KeyTestStatus;
  message: string;
  testedSource: 'admin' | 'server_env' | 'preview_input' | 'none';
  testedAt: string;
  keyStatus: SingleApiKeyStatus;
}> {
  const { rawKeyOverride, actorUid, actorEmail, idToken, activeModel } = params;
  const testedAt = new Date().toISOString();

  if (!cachedSingleKey) {
    await hydrateSingleKeyForSuperAdmin(idToken);
  }

  let keyToTest = '';
  let testedSource: 'admin' | 'server_env' | 'preview_input' | 'none' = 'none';

  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = 'preview_input';
  } else if (cachedSingleKey) {
    keyToTest = cachedSingleKey.rawKey;
    testedSource = 'admin';
  } else {
    const envKey = getEnvFallbackKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = 'server_env';
    }
  }

  if (!keyToTest) {
    return {
      status: 'Invalid key',
      message: 'Chưa có Gemini API key nào được cấu hình. Vui lòng nhập API key ở bên dưới rồi bấm Lưu.',
      testedSource: 'none',
      testedAt,
      keyStatus: await getSingleKeyStatus(),
    };
  }

  let resultStatus: KeyTestStatus = 'Connected';
  const modelToTest = activeModel || 'gemini-4-hydrogen';
  let resultMessage = `Kết nối Gemini API thành công (${modelToTest} phản hồi bình thường).`;

  try {
    const ai = new GoogleGenAI({
      apiKey: keyToTest,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    const resp = await ai.models.generateContent({
      model: modelToTest,
      contents: 'Trả lời 1 từ: OK',
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 16,
      },
    });
    if (!resp.text) {
      resultStatus = 'Temporary provider error';
      resultMessage = 'Model phản hồi rỗng.';
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('400')) {
      resultStatus = 'Invalid key';
      resultMessage = 'API key không hợp lệ hoặc đã bị thu hồi.';
    } else if (rawMsg.includes('SERVICE_DISABLED') || rawMsg.includes('API has not been used')) {
      resultStatus = 'API not enabled';
      resultMessage = 'Generative Language API chưa được bật cho key này.';
    } else if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
      resultStatus = 'Quota exceeded';
      resultMessage = 'Khóa API đã hết hạn mức (429 RESOURCE_EXHAUSTED).';
    } else if (rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('403')) {
      resultStatus = 'Permission denied';
      resultMessage = 'Khóa API bị từ chối quyền truy cập.';
    } else if (rawMsg.includes('NOT_FOUND') || rawMsg.includes('404')) {
      resultStatus = 'Model unavailable';
      resultMessage = `Model ${modelToTest} không khả dụng với khóa hiện tại.`;
    } else {
      resultStatus = 'Temporary provider error';
      resultMessage = `Lỗi tạm thời từ nhà cung cấp: ${rawMsg.slice(0, 140)}`;
    }
  }

  // Persist test status if testing the saved admin key
  if (testedSource === 'admin' && cachedSingleKey) {
    cachedSingleKey.lastTestStatus = resultStatus;
    cachedSingleKey.lastTestAt = testedAt;
    cachedSingleKey.lastTestMessage = resultMessage;

    const encrypted = encryptApiKey(cachedSingleKey.rawKey);
    const updatedDoc: StoredEncryptedSecret = {
      secretId: 'primary',
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedSingleKey.maskedKey,
      label: cachedSingleKey.label,
      updatedAt: cachedSingleKey.updatedAt,
      updatedBy: cachedSingleKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: resultMessage,
    };
    writeLocalEncryptedFile(updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_SECRET_DOC,
        updatedDoc as unknown as Record<string, unknown>,
        idToken
      );
    } catch {
      // Non-fatal if Firestore backup unavailable
    }
  }

  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: 'SINGLE_API_KEY_TESTED',
      resourceType: 'adminSecrets',
      resourceId: 'primary',
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
    keyStatus: await getSingleKeyStatus(),
  };
}

/**
 * Resolves the ONE single Gemini API key used across ALL AI tasks
 * (OCR, subject detection, verification analysis + web grounding, and quiz generation).
 */
export async function resolveActiveGeminiApiKey(): Promise<string> {
  if (cachedSingleKey?.rawKey) {
    return cachedSingleKey.rawKey;
  }

  const envKey = getEnvFallbackKey();
  if (envKey) {
    return envKey;
  }

  throw new Error('GEMINI_API_KEY_UNCONFIGURED');
}
