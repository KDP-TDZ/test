import { auth } from '../firebase';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

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
