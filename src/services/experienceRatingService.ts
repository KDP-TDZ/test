import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, OperationType, testConnection, type FirestoreErrorInfo } from '../firebase';
import {
  buildExperienceRatingRecord,
  validateExperienceRatingInput,
  type ExperienceRatingInput,
  type ExperienceRatingRecord,
} from '../core/experienceRatings';
import { resolveApiUrl } from './apiClient';

export type ExperienceDataSource = 'firestore' | 'live_stream';

export interface ExperienceSubscriptionCallbacks {
  onData: (ratings: ExperienceRatingRecord[], source: ExperienceDataSource) => void;
  onError: (message: string) => void;
}

const EXPERIENCE_RATINGS_COLLECTION = 'experienceRatings';

function logStructuredFirestoreIssue(
  error: unknown,
  operationType: OperationType,
  path: string
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
  };
  console.warn('Firestore experienceRatings notice:', JSON.stringify(errInfo));
  return errInfo;
}

function isPermissionDeniedError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code || '';
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    code === 'permission-denied' ||
    msg.toLowerCase().includes('missing or insufficient permissions') ||
    msg.toLowerCase().includes('permission_denied')
  );
}

function mergeUniqueRatings(
  a: ExperienceRatingRecord[],
  b: ExperienceRatingRecord[]
): ExperienceRatingRecord[] {
  const map = new Map<string, ExperienceRatingRecord>();
  for (const item of b) {
    if (item?.ratingId) map.set(item.ratingId, item);
  }
  for (const item of a) {
    if (item?.ratingId) map.set(item.ratingId, item);
  }
  return Array.from(map.values()).sort(
    (x, y) => Date.parse(y.updatedAt || y.createdAt) - Date.parse(x.updatedAt || x.createdAt)
  );
}

function subscribeServerExperienceStream(callbacks: ExperienceSubscriptionCallbacks): () => void {
  let closed = false;
  let eventSource: EventSource | null = null;
  let pollTimer: number | null = null;

  const fetchSnapshot = async () => {
    try {
      const res = await fetch(resolveApiUrl('/api/experience-ratings'), {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { ratings?: ExperienceRatingRecord[] };
      if (!closed) {
        callbacks.onData(Array.isArray(data.ratings) ? data.ratings : [], 'live_stream');
      }
    } catch {
      if (!closed) {
        callbacks.onError('Không thể tải thống kê trải nghiệm trực tiếp. Vui lòng thử lại.');
      }
    }
  };

  void fetchSnapshot();

  if (typeof window !== 'undefined' && typeof window.EventSource === 'function') {
    try {
      const streamUrl = resolveApiUrl('/api/experience-ratings/stream');
      eventSource = new EventSource(typeof streamUrl === 'string' ? streamUrl : String(streamUrl));
      eventSource.addEventListener('ratings', (event: MessageEvent) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(String(event.data || '{}')) as {
            ratings?: ExperienceRatingRecord[];
          };
          if (Array.isArray(parsed.ratings)) {
            callbacks.onData(parsed.ratings, 'live_stream');
          }
        } catch {
          // Ignore malformed SSE frame
        }
      });
      eventSource.onerror = () => {
        // EventSource auto-reconnects; keep periodic poll backup if disconnected
        if (!closed && pollTimer === null) {
          pollTimer = window.setInterval(() => {
            void fetchSnapshot();
          }, 15_000);
        }
      };
    } catch {
      pollTimer = window.setInterval(() => {
        void fetchSnapshot();
      }, 15_000);
    }
  }

  return () => {
    closed = true;
    eventSource?.close();
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
    }
  };
}

/**
 * Subscribes in real time to public experience ratings.
 * Connects to Firestore `experienceRatings` (`onSnapshot`) first; if Firestore
 * security rules for this collection have not been deployed yet on the project,
 * seamlessly falls back to the real-time SSE stream (`/api/experience-ratings/stream`).
 */
export function subscribeExperienceRatings(
  callbacks: ExperienceSubscriptionCallbacks
): () => void {
  void testConnection();

  let fallbackCleanup: (() => void) | null = null;
  let firestoreUnsub: (() => void) | null = null;
  let disposed = false;

  const q = query(
    collection(db, EXPERIENCE_RATINGS_COLLECTION),
    where('visibility', '==', 'public'),
    limit(250)
  );

  firestoreUnsub = onSnapshot(
    q,
    (snapshot) => {
      if (disposed) return;
      const items = snapshot.docs.map((d) => d.data() as ExperienceRatingRecord);
      callbacks.onData(mergeUniqueRatings(items, []), 'firestore');
    },
    (error) => {
      if (disposed) return;
      logStructuredFirestoreIssue(error, OperationType.LIST, EXPERIENCE_RATINGS_COLLECTION);
      if (isPermissionDeniedError(error)) {
        firestoreUnsub?.();
        firestoreUnsub = null;
        fallbackCleanup = subscribeServerExperienceStream(callbacks);
      } else {
        callbacks.onError('Không thể kết nối luồng thống kê thời gian thực lúc này.');
      }
    }
  );

  return () => {
    disposed = true;
    firestoreUnsub?.();
    fallbackCleanup?.();
  };
}

export async function getUserExperienceRating(
  ratingId: string
): Promise<ExperienceRatingRecord | null> {
  if (!ratingId) return null;
  const path = `${EXPERIENCE_RATINGS_COLLECTION}/${ratingId}`;
  try {
    const snap = await getDoc(doc(db, EXPERIENCE_RATINGS_COLLECTION, ratingId));
    return snap.exists() ? (snap.data() as ExperienceRatingRecord) : null;
  } catch (error) {
    logStructuredFirestoreIssue(error, OperationType.GET, path);
    if (isPermissionDeniedError(error)) {
      try {
        const res = await fetch(
          resolveApiUrl(`/api/experience-ratings/${encodeURIComponent(ratingId)}`),
          { cache: 'no-store' }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { rating?: ExperienceRatingRecord | null };
        return data.rating ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function submitExperienceRating(params: {
  input: ExperienceRatingInput;
  visitorId: string;
  existingRecord?: ExperienceRatingRecord | null;
}): Promise<ExperienceRatingRecord> {
  const validation = validateExperienceRatingInput(params.input);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const currentUser = auth.currentUser;
  const isVerifiedAccount = Boolean(currentUser && currentUser.emailVerified);
  const ratingId = isVerifiedAccount ? currentUser!.uid : params.visitorId;
  const ownerUid = isVerifiedAccount ? currentUser!.uid : 'guest';
  const nowIso = new Date().toISOString();

  const record = buildExperienceRatingRecord({
    ratingId,
    ownerUid,
    isVerifiedAccount,
    sanitized: validation.sanitized,
    createdAt: params.existingRecord?.createdAt || nowIso,
    nowIso,
  });

  const path = `${EXPERIENCE_RATINGS_COLLECTION}/${ratingId}`;

  try {
    const ref = doc(db, EXPERIENCE_RATINGS_COLLECTION, ratingId);
    if (isVerifiedAccount && params.existingRecord) {
      await updateDoc(ref, {
        authorName: record.authorName,
        roleLabel: record.roleLabel,
        stars: record.stars,
        easeOfUse: record.easeOfUse,
        usefulness: record.usefulness,
        speedAndUi: record.speedAndUi,
        comment: record.comment,
        updatedAt: record.updatedAt,
      });
    } else {
      await setDoc(ref, record);
    }
    return record;
  } catch (error) {
    logStructuredFirestoreIssue(
      error,
      params.existingRecord ? OperationType.UPDATE : OperationType.CREATE,
      path
    );

    if (isPermissionDeniedError(error)) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (currentUser && isVerifiedAccount) {
        try {
          const token = await currentUser.getIdToken();
          headers.Authorization = `Bearer ${token}`;
        } catch {
          // Proceed without header if token unavailable
        }
      }
      const res = await fetch(resolveApiUrl('/api/experience-ratings'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ratingId,
          ...validation.sanitized,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        rating?: ExperienceRatingRecord;
        error?: string;
      };
      if (!res.ok || !json.rating) {
        throw new Error(json.error || 'Không thể lưu đánh giá lúc này. Vui lòng thử lại.');
      }
      return json.rating;
    }

    throw new Error('Không thể gửi đánh giá lên máy chủ. Vui lòng kiểm tra kết nối mạng.');
  }
}
