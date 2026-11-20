import {
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_FILES_PER_BATCH,
  MAX_DOCUMENT_UPLOAD_MB,
  MAX_IMAGE_UPLOAD_MB,
  TARGET_COMPRESSED_IMAGE_BYTES,
  splitFilesIntoByteBudgetBatches,
} from '../core/uploadBatching';

export {
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_FILES_PER_BATCH,
  MAX_DOCUMENT_UPLOAD_MB,
  MAX_IMAGE_UPLOAD_MB,
  TARGET_COMPRESSED_IMAGE_BYTES,
  splitFilesIntoByteBudgetBatches,
};

const ADAPTIVE_COMPRESSION_PASSES: Array<{ maxDimension: number; quality: number }> = [
  { maxDimension: 1600, quality: 0.82 },
  { maxDimension: 1360, quality: 0.72 },
  { maxDimension: 1120, quality: 0.62 },
  { maxDimension: 960, quality: 0.54 },
];

async function renderScaledJpegBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  maxDimension: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // White background prevents transparent PNG regions turning black in JPEG
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
  );
}

/**
 * Adaptive client-side downscaling and JPEG compression for camera/scan images (up to 5MB raw)
 * targeting <= 900KB per page while keeping handwriting and math/physics formulas crisp.
 * PDF/DOCX files are returned untouched.
 */
export async function compressImageFileForUpload(
  file: File,
  opts: { maxDimension?: number; quality?: number; targetMaxBytes?: number } = {}
): Promise<File> {
  const targetMaxBytes = opts.targetMaxBytes ?? TARGET_COMPRESSED_IMAGE_BYTES;

  if (!file.type.startsWith('image/')) {
    return file;
  }
  if (typeof document === 'undefined') {
    return file;
  }

  try {
    const imgUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
        el.src = imgUrl;
      });

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) return file;

      const firstMaxDim = opts.maxDimension ?? ADAPTIVE_COMPRESSION_PASSES[0].maxDimension;
      const needsResize = Math.max(width, height) > firstMaxDim;
      if (!needsResize && file.type === 'image/jpeg' && file.size <= 180 * 1024) {
        return file;
      }

      const passes =
        opts.maxDimension !== undefined || opts.quality !== undefined
          ? [
              {
                maxDimension: opts.maxDimension ?? 1600,
                quality: opts.quality ?? 0.82,
              },
              ...ADAPTIVE_COMPRESSION_PASSES.slice(1),
            ]
          : ADAPTIVE_COMPRESSION_PASSES;

      let bestBlob: Blob | null = null;
      for (const pass of passes) {
        const blob = await renderScaledJpegBlob(img, width, height, pass.maxDimension, pass.quality);
        if (!blob) continue;
        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
        }
        if (blob.size <= targetMaxBytes) {
          break;
        }
      }

      if (!bestBlob || (!needsResize && bestBlob.size >= file.size && file.size <= targetMaxBytes)) {
        return file;
      }

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'page';
      return new File([bestBlob], `${baseName}.jpg`, {
        type: 'image/jpeg',
        lastModified: file.lastModified,
      });
    } finally {
      URL.revokeObjectURL(imgUrl);
    }
  } catch {
    return file;
  }
}

export async function compressImageFilesForUpload(
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<File[]> {
  const results: File[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);
    results.push(await compressImageFileForUpload(file));
  }
  return results;
}
