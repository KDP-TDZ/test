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
