/**
 * Lỗi từ Google Flow API — thay thế McpToolError của Orino Flow, giữ nguyên shape
 * (`.code`, `.data`) để các nơi gọi không phải đổi cách xử lý.
 */
export class FlowApiError extends Error {
  code?: number;
  data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'FlowApiError';
    this.code = code;
    this.data = data;
  }
}

/**
 * Lỗi hết quota Veo phía Google (HTTP 429 PUBLIC_ERROR_USER_QUOTA_REACHED).
 *
 * Khác lỗi tạm thời (mint reCAPTCHA timeout, 5xx): retry ngay lập tức KHÔNG bao giờ thành công cho
 * tới khi quota reset, nên tự động thử lại chỉ đập vào API vô ích. Nhận diện để cascade lùi lại và
 * báo đúng nguyên nhân cho người dùng thay vì đổ tại lỗi mạng.
 */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof FlowApiError && err.code === 429) return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /PUBLIC_ERROR_USER_QUOTA_REACHED|RESOURCE_EXHAUSTED|HTTP 429/i.test(message);
}
