import { auth } from '../firebase';

const API_BASE = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

function resolveApiUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string' && input.startsWith('/') && API_BASE) {
    return `${API_BASE}${input}`;
  }
  return input;
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers);
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(resolveApiUrl(input), {
    ...init,
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

  // Non-JSON response (e.g. static host returning 404 "The page could not be found" or HTML)
  const lowered = rawText.trim().toLowerCase();
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

  if (res.status === 413) {
    throw new Error('Dung lượng tệp tải lên vượt quá giới hạn cho phép của máy chủ.');
  }

  throw new Error(rawText.trim().slice(0, 180) || `${fallbackError} (HTTP ${res.status})`);
}
