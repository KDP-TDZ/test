import { auth } from '../firebase';

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
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init: AuthorizedFetchInit = {}
): Promise<Response> {
  const { retryTransient, ...fetchInit } = init;
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
      const res = await fetch(url, {
        ...fetchInit,
        headers,
      });

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

  return fetch(url, {
    ...fetchInit,
    headers,
  });
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

  // Non-JSON response (e.g. Vercel edge 413/504/502 or static host 404 HTML)
  const lowered = rawText.trim().toLowerCase();

  if (
    res.status === 413 ||
    lowered.includes('payload too large') ||
    lowered.includes('request entity too large') ||
    lowered.includes('function_payload_too_large')
  ) {
    throw new Error(
      'Dung lượng gói tải lên vượt quá giới hạn 4.5MB của máy chủ Vercel. Hãy nén tệp PDF/DOCX xuống dưới 4MB hoặc tải ảnh (tối đa 5MB/ảnh, hệ thống sẽ tự nén).'
    );
  }

  if (res.status === 504 || lowered.includes('function_invocation_timeout')) {
    throw new Error(
      'Máy chủ xử lý quá thời gian chờ (504). Hãy thử lại hoặc chia nhỏ tài liệu ít trang hơn.'
    );
  }

  if (
    res.status === 502 ||
    res.status === 503 ||
    lowered.includes('function_invocation_failed')
  ) {
    throw new Error(
      'Máy chủ API tạm thời quá tải hoặc đang khởi động lại (502/503). Vui lòng bấm Thử lại ngay.'
    );
  }

  if (
    res.status === 404 ||
    lowered.includes('the page could not be found') ||
    lowered.startsWith('<!doctype') ||
    lowered.startsWith('<html')
  ) {
    throw new Error(
      'Không tìm thấy máy chủ xử lý API (/api/*). Hãy đảm bảo ứng dụng được deploy kèm backend Node/Serverless (không phải bản tĩnh thuần).'
    );
  }

  throw new Error(rawText.trim().slice(0, 180) || `${fallbackError} (HTTP ${res.status})`);
}
