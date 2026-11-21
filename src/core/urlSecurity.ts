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
  '0.0.0.0',
]);

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
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
  for (const regex of PRIVATE_IPV4_RANGES) {
    if (regex.test(hostname)) {
      return true;
    }
  }
  if (hostname.includes(':')) {
    if (
      hostname === '::1' ||
      hostname.startsWith('fe80:') ||
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
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { valid: false, reason: 'Không được phép truy cập địa chỉ nội bộ hoặc metadata endpoint.' };
  }

  // Block private IPv4 ranges
  for (const regex of PRIVATE_IPV4_RANGES) {
    if (regex.test(hostname)) {
      return { valid: false, reason: 'Không được phép truy cập dải IP nội bộ.' };
    }
  }

  // Block IPv6 private/link-local literals
  if (hostname.startsWith('[') || hostname.includes(':')) {
    const clean = hostname.replace(/^\[|\]$/g, '');
    if (
      clean === '::1' ||
      clean.startsWith('fe80:') ||
      clean.startsWith('fc') ||
      clean.startsWith('fd') ||
      clean.includes('127.0.0.1') ||
      clean.includes('169.254.')
    ) {
      return { valid: false, reason: 'Không được phép truy cập địa chỉ IPv6 nội bộ.' };
    }
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}
