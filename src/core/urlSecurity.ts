const PRIVATE_IPV4_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
  '::1',
  '[::1]',
  '::',
  '[::]',
  '0:0:0:0:0:0:0:1',
  '0:0:0:0:0:0:0:0',
  '0.0.0.0',
]);

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some((regex) => regex.test(ip));
}

function extractMappedIpv4FromIpv6(cleanIpv6: string): string | null {
  // Dotted-quad form: ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:127.0.0.1
  const dottedMatch = cleanIpv6.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMatch) {
    return dottedMatch[1];
  }
  // Hex-pair form produced by WHATWG URL parser: ::ffff:7f00:1 or ::ffff:a9fe:a9fe
  const hexMatch = cleanIpv6.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }
  return null;
}

export function isPrivateOrLoopbackHost(hostOrIp: string): boolean {
  const hostname = hostOrIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) return true;
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return true;
  }
  if (isPrivateIpv4(hostname)) {
    return true;
  }
  if (hostname.includes(':')) {
    const mappedIpv4 = extractMappedIpv4FromIpv6(hostname);
    if (mappedIpv4 && isPrivateIpv4(mappedIpv4)) {
      return true;
    }
    if (
      hostname === '::1' ||
      hostname === '::' ||
      /^fe[89ab][0-9a-f]?:/i.test(hostname) ||
      hostname.startsWith('fc') ||
      hostname.startsWith('fd') ||
      hostname.includes('127.0.0.1') ||
      hostname.includes('169.254.')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates external URLs for Reference Library ingestion against SSRF and insecure protocols.
 * Only HTTPS is allowed; localhost, internal IPs, link-local, and cloud metadata endpoints are blocked.
 */
export function validateReferenceUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Đường dẫn URL không được để trống.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Định dạng URL không hợp lệ.' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Chỉ chấp nhận đường dẫn HTTPS bảo mật.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URL không được chứa thông tin đăng nhập nhúng.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(hostname)) {
    return { valid: false, reason: 'Không được phép truy cập địa chỉ nội bộ hoặc metadata endpoint.' };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Sanitizes an external URL before rendering in <a href> so javascript:/data:/vbscript:
 * schemes can never execute script in the browser.
 */
export function sanitizeExternalHttpUrl(rawUrl?: string | null): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Checks whether a browser Origin header is permitted to access API responses.
 * Allows exact same-origin requests (matching requestHost) or origins explicitly present
 * in allowlist. Never reflects wildcard "*" or arbitrary third-party origins.
 */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  allowlist: string[]
): boolean {
  if (!origin) return false;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  const normalizedOrigin = parsedOrigin.origin.toLowerCase();
  const normalizedHost = (requestHost || '').split(',')[0].trim().toLowerCase();
  if (normalizedHost && parsedOrigin.host.toLowerCase() === normalizedHost) {
    return true;
  }

  for (const rawAllowed of allowlist) {
    const entry = rawAllowed.trim();
    if (!entry || entry === '*') continue;
    try {
      const parsedAllowed = new URL(entry);
      if (parsedAllowed.origin.toLowerCase() === normalizedOrigin) {
        return true;
      }
    } catch {
      if (entry.toLowerCase().replace(/\/+$/, '') === normalizedOrigin) {
        return true;
      }
    }
  }
  return false;
}

export function isValidFirestoreDocId(id: string): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}
