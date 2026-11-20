import type { GradeLevel, SubjectId } from './types.js';

export const MAX_IMAGE_UPLOAD_MB = 5;
export const MAX_DOCUMENT_UPLOAD_MB = 4;
export const TARGET_COMPRESSED_IMAGE_BYTES = 900 * 1024;
export const DEFAULT_MAX_BATCH_BYTES = Math.floor(2.6 * 1024 * 1024);
export const DEFAULT_MAX_FILES_PER_BATCH = 4;

export interface UploadLimits {
  maxImageMb: number;
  maxDocumentMb: number;
  maxImageBytes: number;
  maxDocumentBytes: number;
}

export function getEffectiveUploadLimits(adminMaxFileMb?: number): UploadLimits {
  const safeAdmin =
    typeof adminMaxFileMb === 'number' && Number.isFinite(adminMaxFileMb) && adminMaxFileMb > 0
      ? adminMaxFileMb
      : 20;
  const maxImageMb = Math.min(safeAdmin, MAX_IMAGE_UPLOAD_MB);
  const maxDocumentMb = Math.min(safeAdmin, MAX_DOCUMENT_UPLOAD_MB);
  return {
    maxImageMb,
    maxDocumentMb,
    maxImageBytes: Math.round(maxImageMb * 1024 * 1024),
    maxDocumentBytes: Math.round(maxDocumentMb * 1024 * 1024),
  };
}

export function isDocumentFileLike(file: { name: string; type?: string }): boolean {
  const lower = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return (
    mime === 'application/pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.pdf') ||
    lower.endsWith('.docx')
  );
}

export function validateUploadFileSize(
  file: { name: string; size: number; type?: string },
  adminMaxFileMb?: number
): { ok: true } | { ok: false; error: string; isDocumentLimit: boolean } {
  const limits = getEffectiveUploadLimits(adminMaxFileMb);
  const isDoc = isDocumentFileLike(file);

  if (isDoc) {
    if (file.size > limits.maxDocumentBytes) {
      const actualMb = (file.size / (1024 * 1024)).toFixed(2);
      return {
        ok: false,
        isDocumentLimit: true,
        error: `Tệp tài liệu "${file.name}" (${actualMb}MB) vượt quá giới hạn an toàn ${limits.maxDocumentMb}MB cho PDF/DOCX trên máy chủ Vercel. Hãy nén file nhỏ hơn ${limits.maxDocumentMb}MB hoặc chụp ảnh từng trang (hỗ trợ ảnh gốc tới ${limits.maxImageMb}MB/ảnh).`,
      };
    }
    return { ok: true };
  }

  if (file.size > limits.maxImageBytes) {
    const actualMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      ok: false,
      isDocumentLimit: false,
      error: `Ảnh "${file.name}" (${actualMb}MB) vượt quá giới hạn tối đa ${limits.maxImageMb}MB/ảnh.`,
    };
  }

  return { ok: true };
}

export function splitFilesIntoByteBudgetBatches<T extends { size: number }>(
  files: T[],
  opts: { maxBatchBytes?: number; maxFilesPerBatch?: number } = {}
): T[][] {
  if (files.length === 0) return [];
  const maxBatchBytes = Math.max(256 * 1024, opts.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES);
  const maxFilesPerBatch = Math.max(1, opts.maxFilesPerBatch ?? DEFAULT_MAX_FILES_PER_BATCH);

  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const fileSize = Math.max(0, Number(file.size) || 0);
    const exceedsBytes = current.length > 0 && currentBytes + fileSize > maxBatchBytes;
    const exceedsCount = current.length >= maxFilesPerBatch;

    if (exceedsBytes || exceedsCount) {
      batches.push(current);
      current = [file];
      currentBytes = fileSize;
    } else {
      current.push(file);
      currentBytes += fileSize;
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

export interface FileNameScopeInference {
  grade: GradeLevel | null;
  subject: SubjectId | null;
  confidence: 'high' | 'medium' | 'low';
}

function normalizeVietnameseTokenText(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-.,()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUBJECT_KEYWORD_RULES: Array<{
  subject: NonNullable<FileNameScopeInference['subject']>;
  patterns: RegExp[];
}> = [
  {
    subject: 'vat_ly',
    patterns: [
      /\b(vat\s*ly|vat\s*li|vly|mon\s*ly|de\s*ly|dao\s*dong|song\s*co|song\s*dien\s*tu|dien\s*xoay\s*chieu|mach\s*rlc|hat\s*nhan|luong\s*tu|quang\s*hoc|nhiet\s*hoc|dong\s*luc\s*hoc|dong\s*hoc|chuyen\s*dong|con\s*lac|tu\s*truong|dien\s*truong|cam\s*ung\s*dien\s*tu|dinh\s*luat\s*ohm|newton|coulomb)\b/,
      /\b(ly|li)\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'hoa_hoc',
    patterns: [
      /\b(hoa\s*hoc|mon\s*hoa|de\s*hoa|este|lipit|cacbohidrat|glucozo|fructozo|saccarozo|tinh\s*bot|xenlulozo|amin|amino\s*axit|peptit|protein|polime|kim\s*loai|kiem\s*tho|nhom|sat|crom|hidrocacbon|ankan|anken|ankin|ankadien|aren|benzen|ancol|phenol|andehit|axit\s*cacboxylic|nguyen\s*tu|bang\s*tuan\s*hoan|phan\s*ung\s*oxi\s*hoa|dien\s*li|dien\s*phan|toc\s*do\s*phan\s*ung|can\s*bang\s*hoa\s*hoc)\b/,
      /\bhoa\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'toan',
    patterns: [
      /\b(toan\s*hoc|mon\s*toan|de\s*toan|dai\s*so|hinh\s*hoc|giai\s*tich|ham\s*so|dao\s*ham|tich\s*phan|nguyen\s*ham|logarit|mu\s*logarit|luong\s*giac|to\s*hop|xac\s*suat|cap\s*so\s*cong|cap\s*so\s*nhan|vecto|toa\s*do\s*oxy|oxyz|so\s*phuc|bat\s*phuong\s*trinh|he\s*phuong\s*trinh|khoi\s*da\s*dien|mat\s*cau|mat\s*non|mat\s*tru|thong\s*ke)\b/,
      /\btoan\s*(10|11|12)?\b/,
    ],
  },
  {
    subject: 'sinh_hoc',
    patterns: [
      /\b(sinh\s*hoc|mon\s*sinh|de\s*sinh|di\s*truyen|bien\s*di|dot\s*bien|adn|arn|gen|ma\s*di\s*truyen|phien\s*ma|dich\s*ma|nhiem\s*sac\s*the|te\s*bao|quang\s*hop|ho\s*hap|tien\s*hoa|sinh\s*thai|quan\s*the|quan\s*xa|he\s*sinh\s*thai|chuyen\s*hoa\s*vat\s*chat)\b/,
      /\bsinh\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'ngu_van',
    patterns: [
      /\b(ngu\s*van|mon\s*van|van\s*hoc|nghi\s*luan|doc\s*hieu|lam\s*van|phan\s*tich\s*tho|truyen\s*ngan|tay\s*tien|viet\s*bac|dat\s*nuoc|vo\s*nhat|vo\s*chong\s*a\s*phu|chi\s*pheo|hai\s*dua\s*tre|chu\s*nguoi\s*tu\s*tu)\b/,
      /\bvan\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'tieng_anh',
    patterns: [
      /\b(tieng\s*anh|mon\s*anh|english|grammar|vocabulary|reading|listening|ielts|toeic|phonetics|tenses|relative\s*clause|passive\s*voice|conditional|reported\s*speech)\b/,
      /\banh\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'lich_su',
    patterns: [
      /\b(lich\s*su|mon\s*su|de\s*su|cach\s*mang|chien\s*tranh|the\s*gioi|viet\s*nam|khang\s*chien|phong\s*trao|dien\s*bien\s*phu|asean|lien\s*hop\s*quoc|chien\s*tranh\s*lanh)\b/,
      /\bsu\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'dia_ly',
    patterns: [
      /\b(dia\s*ly|dia\s*li|mon\s*dia|de\s*dia|khi\s*hau|dia\s*hinh|dan\s*cu|vung\s*kinh\s*te|atlat|tu\s*nhien|dong\s*bang\s*song\s*hong|dong\s*bang\s*song\s*cuu\s*long|tay\s*nguyen)\b/,
      /\bdia\s*(10|11|12)\b/,
    ],
  },
  {
    subject: 'gdkt_pl',
    patterns: [
      /\b(gdkt\s*pl|gdktpl|gdcd|giao\s*duc\s*kinh\s*te|phap\s*luat|cong\s*dan|hien\s*phap|thi\s*truong|ngan\s*sach|thue|tin\s*dung|lam\s*phat|that\s*nghiep|quyen\s*binh\s*dang)\b/,
    ],
  },
  {
    subject: 'tin_hoc',
    patterns: [
      /\b(tin\s*hoc|mon\s*tin|lap\s*trinh|python|c\+\+|pascal|thuat\s*toan|co\s*so\s*du\s*lieu|sql|html|css|mang\s*may\s*tinh|tri\s*tue\s*nhan\s*tao)\b/,
      /\btin\s*(10|11|12)\b/,
    ],
  },
];

export function isGenericCameraFileNames(fileNames: string[]): boolean {
  const clean = fileNames.map((n) => (n || '').trim()).filter(Boolean);
  if (clean.length === 0) return true;
  return clean.every((name) =>
    /^(img|dsc|screenshot|image|photo|page|trang|scan|cam|whatsapp|viber|zalo|pxl|mvimg|z\d+)[\s_\-\d().a-f]*(\.[a-z0-9]+)?$/i.test(
      name
    ) || /^[\d_\-\s().]+(\.[a-z0-9]+)?$/i.test(name)
  );
}

export function buildFileNameSuggestionCacheKey(
  fileNames: string[],
  defaultGrade: GradeLevel = '10'
): string {
  const normalized = fileNames
    .map(normalizeVietnameseTokenText)
    .filter(Boolean)
    .slice(0, 15)
    .join('|');
  return `${defaultGrade}::${normalized}`;
}

export function inferGradeAndSubjectFromFileNames(
  fileNames: string[]
): FileNameScopeInference {
  const combined = fileNames.map(normalizeVietnameseTokenText).filter(Boolean).join(' ');
  if (!combined) {
    return { grade: null, subject: null, confidence: 'low' };
  }

  let detectedGrade: GradeLevel | null = null;
  const explicitGradeMatch =
    combined.match(/\b(?:lop|khoi|k|grade)\s*(10|11|12)\b/) ||
    combined.match(/\b(?:toan|ly|li|hoa|sinh|van|anh|su|dia|tin|gdcd|gdktpl)(10|11|12)\b/) ||
    combined.match(/\b(?:toan|ly|li|hoa|sinh|van|anh|su|dia|tin|gdcd|gdktpl)\s+(10|11|12)\b/);

  if (explicitGradeMatch) {
    detectedGrade = explicitGradeMatch[1] as GradeLevel;
  } else {
    const standaloneGradeMatch = combined.match(/(?:^|\s)(10|11|12)(?:\s|$)/);
    if (standaloneGradeMatch) {
      detectedGrade = standaloneGradeMatch[1] as GradeLevel;
    }
  }

  let detectedSubject: FileNameScopeInference['subject'] = null;
  for (const rule of SUBJECT_KEYWORD_RULES) {
    if (rule.patterns.some((re) => re.test(combined))) {
      detectedSubject = rule.subject;
      break;
    }
  }

  const confidence: FileNameScopeInference['confidence'] =
    detectedSubject && detectedGrade
      ? 'high'
      : detectedSubject || detectedGrade
      ? 'medium'
      : 'low';

  return {
    grade: detectedGrade,
    subject: detectedSubject,
    confidence,
  };
}

