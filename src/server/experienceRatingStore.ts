import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Response } from 'express';
import {
  buildExperienceRatingRecord,
  isValidExperienceRatingId,
  isValidGuestRatingId,
  validateExperienceRatingInput,
  type ExperienceRatingInput,
  type ExperienceRatingRecord,
} from '../core/experienceRatings.js';

const MAX_STORED_RATINGS = 500;

function resolveStoreFilePath(): string {
  if (process.env.VERCEL === '1') {
    return path.join(os.tmpdir(), 'studycheck-experience-ratings.json');
  }
  return path.resolve(process.cwd(), 'data', 'experience-ratings.json');
}

const storePath = resolveStoreFilePath();
const ratingsMap = new Map<string, ExperienceRatingRecord>();
const sseClients = new Set<Response>();
let loadedFromDisk = false;

function ensureLoaded(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    if (!fs.existsSync(storePath)) return;
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as ExperienceRatingRecord).ratingId === 'string' &&
        isValidExperienceRatingId((item as ExperienceRatingRecord).ratingId) &&
        typeof (item as ExperienceRatingRecord).stars === 'number'
      ) {
        const rec = item as ExperienceRatingRecord;
        ratingsMap.set(rec.ratingId, rec);
      }
    }
  } catch (err) {
    console.warn('Experience rating store load skipped:', err);
  }
}

function persistToDisk(): void {
  try {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const list = listStoredExperienceRatings();
    const tmpPath = `${storePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmpPath, storePath);
  } catch (err) {
    console.warn('Experience rating store disk write skipped:', err);
  }
}

export function listStoredExperienceRatings(): ExperienceRatingRecord[] {
  ensureLoaded();
  return Array.from(ratingsMap.values()).sort(
    (a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)
  );
}

export function getStoredExperienceRating(ratingId: string): ExperienceRatingRecord | null {
  ensureLoaded();
  if (!isValidExperienceRatingId(ratingId)) return null;
  return ratingsMap.get(ratingId) ?? null;
}

export function broadcastExperienceRatingsSnapshot(): void {
  if (sseClients.size === 0) return;
  const payload = JSON.stringify({ ratings: listStoredExperienceRatings() });
  const frame = `event: ratings\ndata: ${payload}\n\n`;
  for (const client of Array.from(sseClients)) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function attachExperienceRatingsSseClient(res: Response): () => void {
  ensureLoaded();
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  const initialPayload = JSON.stringify({ ratings: listStoredExperienceRatings() });
  res.write(`event: ratings\ndata: ${initialPayload}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25_000);

  return () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  };
}

export function saveStoredExperienceRating(params: {
  input: Partial<ExperienceRatingInput>;
  ratingId: string;
  authenticatedUid?: string;
}): { ok: true; record: ExperienceRatingRecord } | { ok: false; status: number; error: string } {
  ensureLoaded();
  const validation = validateExperienceRatingInput(params.input);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.error };
  }

  const isAuth = Boolean(params.authenticatedUid);
  const resolvedId = isAuth ? params.authenticatedUid! : params.ratingId;

  if (isAuth) {
    if (!isValidExperienceRatingId(resolvedId)) {
      return { ok: false, status: 400, error: 'Mã tài khoản không hợp lệ.' };
    }
  } else {
    if (!isValidGuestRatingId(resolvedId)) {
      return { ok: false, status: 400, error: 'Mã phiên đánh giá khách không hợp lệ.' };
    }
    if (ratingsMap.has(resolvedId)) {
      return {
        ok: false,
        status: 409,
        error: 'Trình duyệt này đã gửi đánh giá trước đó.',
      };
    }
  }

  const existing = ratingsMap.get(resolvedId);
  const nowIso = new Date().toISOString();
  const record = buildExperienceRatingRecord({
    ratingId: resolvedId,
    ownerUid: isAuth ? params.authenticatedUid! : 'guest',
    isVerifiedAccount: isAuth,
    sanitized: validation.sanitized,
    createdAt: existing?.createdAt || nowIso,
    nowIso,
  });

  if (ratingsMap.size >= MAX_STORED_RATINGS && !ratingsMap.has(resolvedId)) {
    const sorted = listStoredExperienceRatings();
    const oldest = sorted[sorted.length - 1];
    if (oldest) {
      ratingsMap.delete(oldest.ratingId);
    }
  }

  ratingsMap.set(resolvedId, record);
  persistToDisk();
  broadcastExperienceRatingsSnapshot();
  return { ok: true, record };
}
