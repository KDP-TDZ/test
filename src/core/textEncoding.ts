const WIN1252_REVERSE_MAP: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

const HIGH_BYTE_RUN_REGEX =
  /[\u0080-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]{2,}/g;

const utf8FatalDecoder = new TextDecoder('utf-8', { fatal: true });

function decodeLatin1HighRunAsUtf8(segment: string): string {
  const bytes = new Uint8Array(segment.length);
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (code <= 0xff) {
      bytes[i] = code;
    } else {
      const mapped = WIN1252_REVERSE_MAP[code];
      if (mapped === undefined) {
        return segment;
      }
      bytes[i] = mapped;
    }
  }

  try {
    const decoded = utf8FatalDecoder.decode(bytes);
    if (!decoded || /[\u0000-\u001F\u007F-\u009F\uFFFD]/.test(decoded)) {
      return segment;
    }
    return decoded;
  } catch {
    return segment;
  }
}

/**
 * Safely repairs UTF-8 strings that were mis-decoded as Latin-1 / Windows-1252
 * (for example `SC-09_sinh_há»\u008dc_10` -> `SC-09_sinh_học_10`), while leaving
 * valid Vietnamese Unicode strings untouched.
 */
export function repairUtf8Mojibake(value: string): string {
  if (!value || typeof value !== 'string') return value || '';

  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.replace(HIGH_BYTE_RUN_REGEX, (run) => decodeLatin1HighRunAsUtf8(run));
    if (next === current) break;
    current = next;
  }
  return current;
}
