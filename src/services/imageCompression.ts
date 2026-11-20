/**
 * Client-side downscaling (max 1600px long edge) and JPEG compression (quality 0.8)
 * for camera/scan images while keeping PDF/DOCX files untouched and handwriting/formulas crisp.
 */
export async function compressImageFileForUpload(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {}
): Promise<File> {
  const maxDimension = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.8;

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

      const needsResize = Math.max(width, height) > maxDimension;
      if (!needsResize && file.type === 'image/jpeg' && file.size <= 180 * 1024) {
        return file;
      }

      const scale = Math.min(1, maxDimension / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // White background prevents transparent PNG regions turning black in JPEG
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
      );
      if (!blob || (!needsResize && blob.size >= file.size)) {
        return file;
      }

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'page';
      return new File([blob], `${baseName}.jpg`, {
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
