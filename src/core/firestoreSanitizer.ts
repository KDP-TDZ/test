/**
 * Recursively removes keys with `undefined` values from objects and arrays
 * so payloads are always safe for Firebase Firestore `setDoc` / `updateDoc`.
 * Preserves `null`, primitives, Dates, and non-undefined array elements.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    const cleaned = value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item));
    return cleaned as unknown as T;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (typeof v === 'number' && Number.isNaN(v)) continue;
      out[k] = stripUndefinedDeep(v);
    }
    return out as T;
  }

  return value;
}
