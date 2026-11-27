import { auth } from '../firebaseAuth';
import { formatNonJsonApiError } from '../core/apiErrorFormatting';

const API_BASE = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

export function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/') && API_BASE) {
    return `${API_BASE}${input}`;
  }
  return input;
}

export interface AuthorizedFetchInit extends RequestInit {
  /** Retry once on transient network / 502 / 503 gateway errors (never retries 4xx / 413 / 429 / 504). */
  retryTransient?: boolean;
  /** Optional client-side safety timeout in milliseconds so requests never hang indefinitely. */
  timeoutMs?: number;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError' || err.name === 'TimeoutError'
    : err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

async function fetchWithOptionalTimeout(
  url: RequestInfo | URL,
  init: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new Error(
        'Yêu cầu xử lý vượt quá thời gian chờ. Máy chủ AI đang bận — vui lòng bấm Thử lại.'
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init: AuthorizedFetchInit = {}
): Promise<Response> {
  const { retryTransient, timeoutMs, ...fetchInit } = init;
  const method = (fetchInit.method || 'GET').toUpperCase();
  const shouldRetry =
    typeof retryTransient === 'boolean'
      ? retryTransient
      : method === 'GET' || method === 'HEAD';
  const user = auth.currentUser;
  const headers = new Headers(fetchInit.headers);
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = resolveApiUrl(input);
  const maxAttempts = shouldRetry ? 2 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetchWithOptionalTimeout(
        url,
        {
          ...fetchInit,
          headers,
        },
        timeoutMs
      );

      if ((res.status === 502 || res.status === 503) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }

      return res;
    } catch (err) {
      if (isAbortError(err) || attempt >= maxAttempts) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  return fetchWithOptionalTimeout(
    url,
    {
      ...fetchInit,
      headers,
    },
    timeoutMs
  );
}

export interface ApiProviderHealthItem {
  provider: 'mistral' | 'groq' | 'cloudflare';
  configured: boolean;
  status: 'healthy' | 'unconfigured' | 'billing_blocked' | 'auth_error' | 'cooldown';
  coolingDown: boolean;
  cooldownUntil?: string;
  remainingSeconds: number;
  lastErrorCode?: string;
  lastError?: string;
  failedAt?: string;
}

export interface ApiAttemptTraceItem {
  provider: 'mistral' | 'groq' | 'cloudflare';
  modelId: string;
  status: 'success' | 'failed' | 'skipped';
  durationMs: number;
  errorCode?: string;
  error?: string;
}

export interface ApiErrorDebugPayload {
  activeModel?: string;
  configuredProviders?: { mistral: boolean; groq: boolean; cloudflare: boolean };
  providerHealth?: Record<'mistral' | 'groq' | 'cloudflare', ApiProviderHealthItem>;
  attemptTrace?: ApiAttemptTraceItem[];
  recentExecutions?: Array<{
    executionId: string;
    taskType: string;
    requestedModel?: string;
    actualModel?: string;
    modelId: string;
    usedFallback?: boolean;
    status: string;
    durationMs: number;
    error?: string;
    timestamp: string;
  }>;
  timestamp?: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly technicalDetail?: string;
  readonly debug?: ApiErrorDebugPayload;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string;
      technicalDetail?: string;
      debug?: ApiErrorDebugPayload;
    }
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = opts.status;
    this.code = opts.code;
    this.technicalDetail = opts.technicalDetail;
    this.debug = opts.debug;
  }
}

export async function parseApiResponse<T = Record<string, any>>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const rawText = await res.text();
  let parsed: Record<string, any> | null = null;

  if (rawText.trim().length > 0) {
    try {
      parsed = JSON.parse(rawText) as Record<string, any>;
    } catch {
      parsed = null;
    }
  }

  if (parsed !== null) {
    if (!res.ok) {
      const msg =
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.message === 'string' && parsed.message) ||
        fallbackError;
      throw new ApiRequestError(msg, {
        status: res.status,
        code: typeof parsed.code === 'string' ? parsed.code : undefined,
        technicalDetail:
          typeof parsed.technicalDetail === 'string' ? parsed.technicalDetail : undefined,
        debug:
          parsed.debug && typeof parsed.debug === 'object'
            ? (parsed.debug as ApiErrorDebugPayload)
            : undefined,
      });
    }
    return parsed as T;
  }

  throw new ApiRequestError(formatNonJsonApiError(res.status, rawText, fallbackError), {
    status: res.status,
    technicalDetail: rawText.slice(0, 400) || undefined,
  });
}
