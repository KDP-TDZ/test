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
      throw new Error(
        (typeof parsed.error === 'string' && parsed.error) ||
          (typeof parsed.message === 'string' && parsed.message) ||
          fallbackError
      );
    }
    return parsed as T;
  }

  throw new Error(formatNonJsonApiError(res.status, rawText, fallbackError));
}
