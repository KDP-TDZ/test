/**
 * Browser & Node compatible deterministic hash + bounded TTL LRU cache.
 * Used to deduplicate identical AI requests without external Redis/paid dependencies.
 */

export function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) {
        sorted[key] = canonicalizeValue(obj[key]);
      }
    }
    return sorted;
  }
  return value;
}

export function computeStableTextDigest(input: string): string {
  const normalized = (input || '').normalize('NFC');
  // Dual 64-bit FNV-1a mix producing a deterministic 32-char hex digest (128-bit effective key)
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;

  for (let i = 0; i < normalized.length; i += 1) {
    const code = BigInt(normalized.charCodeAt(i));
    h1 ^= code;
    h1 = (h1 * prime) & mask;
    h2 ^= code + BigInt((i % 251) + 1);
    h2 = (h2 * prime) & mask;
  }

  return `${h1.toString(16).padStart(16, '0')}${h2.toString(16).padStart(16, '0')}`;
}

export function buildDeterministicCacheKey(parts: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalizeValue(parts));
  return computeStableTextDigest(canonical);
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class BoundedTtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries = 150, defaultTtlMs = 30 * 60 * 1000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
