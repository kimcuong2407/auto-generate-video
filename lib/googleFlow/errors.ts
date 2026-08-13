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
