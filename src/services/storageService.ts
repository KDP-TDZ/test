export interface UploadResult {
  storagePath: string;
  downloadUrl: string;
  storageAvailable: boolean;
  warning?: string;
}

/**
 * Spark-tier zero-billing document pipeline:
 * Files are uploaded directly to the backend /api/ai/extract endpoint for OCR & extraction,
 * and structured pages, claims, and annotations are persisted in Cloud Firestore.
 */
export async function uploadPrivateStudentFile(params: {
  uid: string;
  documentId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  params.onProgress?.(100);
  return {
    storagePath: '',
    downloadUrl: '',
    storageAvailable: false,
  };
}

export async function deletePrivateStorageFile(_storagePath: string): Promise<void> {
  // No external Storage bucket required on zero-billing Spark tier.
}

export async function uploadReferencePdfFile(params: {
  referenceId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult> {
  params.onProgress?.(100);
  return {
    storagePath: '',
    downloadUrl: '',
    storageAvailable: false,
  };
}
