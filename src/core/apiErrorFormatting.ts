/**
 * Pure formatting helper for non-JSON HTTP API error responses (e.g. Vercel edge 500/502/503/504/413,
 * proxy HTML error pages, or upstream gateway plain-text errors containing opaque request IDs).
 */
export function formatNonJsonApiError(
  status: number,
  rawText: string,
  fallbackError: string
): string {
  const trimmed = (rawText || '').trim();
  const lowered = trimmed.toLowerCase();

  if (
    status === 413 ||
    lowered.includes('payload too large') ||
    lowered.includes('request entity too large') ||
    lowered.includes('function_payload_too_large')
  ) {
    return 'Dung lượng gói tải lên vượt quá giới hạn 4.5MB của máy chủ. Hãy nén tệp PDF/DOCX xuống dưới 4MB hoặc tải ảnh (tối đa 5MB/ảnh, hệ thống sẽ tự nén).';
  }

  if (
    status === 504 ||
    lowered.includes('function_invocation_timeout') ||
    lowered.includes('gateway timeout')
  ) {
    return 'Máy chủ xử lý quá thời gian chờ (504). Hãy bấm Thử lại hoặc chọn sẵn Môn học để rút ngắn thời gian xử lý.';
  }

  if (
    status === 502 ||
    status === 503 ||
    lowered.includes('function_invocation_failed') ||
    lowered.includes('bad gateway') ||
    lowered.includes('service unavailable')
  ) {
    return 'Máy chủ API tạm thời quá tải hoặc đang khởi động lại (502/503). Vui lòng bấm Thử lại ngay.';
  }

  if (
    status === 500 ||
    lowered.includes('internal server error') ||
    lowered.includes('a server error has occurred')
  ) {
    return 'Máy chủ AI tạm thời gặp sự cố kết nối hoặc vượt thời gian xử lý (500). Vui lòng bấm Thử lại — nếu lỗi lặp lại, hãy chọn sẵn Môn học trước khi gửi.';
  }

  if (
    status === 404 ||
    lowered.includes('the page could not be found') ||
    lowered.startsWith('<!doctype') ||
    lowered.startsWith('<html') ||
    lowered.includes('<html')
  ) {
    return 'Không tìm thấy máy chủ xử lý API (/api/*). Hãy đảm bảo ứng dụng được deploy kèm backend Node/Serverless.';
  }

  // Strip HTML tags or opaque random request IDs if any leaked into plain text
  const stripped = trimmed
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b[A-Za-z0-9]{24,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length >= 6) {
    return stripped.slice(0, 180);
  }
  return `${fallbackError} (HTTP ${status})`;
}
