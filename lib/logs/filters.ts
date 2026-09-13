/**
 * Phân tích + kiểm tra BỘ LỌC của tab log, tách khỏi route để self-check chạy được không cần DB.
 *
 * Phần quan trọng nhất ở đây là `hasAnyFilter`: nó là chốt chặn ca tệ nhất của tính năng xoá —
 * một lỗi fetch ở UI làm mọi filter thành undefined, rồi DELETE không điều kiện quét sạch bảng.
 * Từ khi bỏ cắt tỉa, DELETE là đường DUY NHẤT làm mất log, nên nó phải khó bấm nhầm.
 */
import { isFilterableSourceKind, type SourceKind } from './sourceKind';
import { vnDayToUtcSql } from '../format/datetime';

/** Trạng thái lượt chạy: tất cả / chỉ thành công / chỉ lỗi. */
export type LogStatus = 'all' | 'ok' | 'error';

export interface LogFilters {
  /** Có thể chứa '' — nhãn của log ghi trước migration 0025. Xem isFilterableSourceKind. */
  sourceKinds: (SourceKind | '')[];
  steps: string[];
  model: string;
  /** Khớp job_slug HOẶC project_id — Mr.D không phải nhớ id nào thuộc cột nào. */
  owner: string;
  status: LogStatus;
  errorKind: string;
  /** Mốc UTC đã quy đổi từ ngày giờ VN, dạng "YYYY-MM-DD HH:MM:SS.mmm". */
  fromUtc: string | null;
  toUtc: string | null;
}

/** Trần cứng: bảng giữ vĩnh viễn nên không có gì chặn sẵn số dòng ngoài chỗ này. */
export const MAX_LOG_LIMIT = 200;
export const DEFAULT_LOG_LIMIT = 50;

function csv(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Như csv() nhưng GIỮ chuỗi rỗng, vì '' là một giá trị lọc THẬT (log cũ chưa có source_kind).
 *
 * csv() thường bỏ '' để ô nhập trống không thành một điều kiện WHERE rỗng nghĩa. Ở riêng cột
 * source_kind thì ngược lại: bỏ '' đi là bấm chip "không rõ (log cũ)" ra 0 dòng dù bảng đầy dữ
 * liệu. Tách hàm thay vì thêm cờ cho csv() để chỗ gọi đọc ra ngay là đang cố ý giữ ''.
 *
 * Phân biệt "không lọc" với "lọc đúng ''": tham số VẮNG MẶT → parseLogFilters nhận null → mảng
 * rỗng; tham số CÓ MẶT dạng `sourceKind=` → mảng [''].
 */
function csvKeepEmpty(value: string | null): string[] {
  if (value === null) return [];
  // Khử trùng lặp: `sourceKind=,,,` là chuỗi RÁC, không phải "chọn log cũ ba lần". Không khử thì
  // nó thành mảng ['','',''] — độ dài 3 nên lọt qua mọi chốt chặn đếm theo length, và với lệnh
  // XOÁ thì một chuỗi rác vô tình lại đủ tư cách quét sạch toàn bộ log cũ.
  return [...new Set(value.split(',').map((x) => x.trim()))];
}

/**
 * Đọc bộ lọc từ query string. Giá trị lạ bị LOẠI chứ không ném: tab log là chỗ để chẩn đoán, trả
 * 400 vì một tham số thừa sẽ biến nó thành thứ phải đi chẩn đoán trước.
 */
export function parseLogFilters(params: URLSearchParams): LogFilters {
  const statusRaw = params.get('status');
  const status: LogStatus = statusRaw === 'ok' || statusRaw === 'error' ? statusRaw : 'all';
  return {
    sourceKinds: csvKeepEmpty(params.get('sourceKind')).filter(isFilterableSourceKind) as (SourceKind | '')[],
    steps: csv(params.get('step')),
    model: (params.get('model') ?? '').trim(),
    owner: (params.get('owner') ?? '').trim(),
    status,
    errorKind: (params.get('errorKind') ?? '').trim(),
    // Ngày người dùng nhập là ngày GIỜ VN; cột lưu UTC nên phải quy đổi, nếu không lệch 7 tiếng.
    fromUtc: vnDayToUtcSql(params.get('from') ?? ''),
    toUtc: vnDayToUtcSql(params.get('to') ?? '', true),
  };
}

/**
 * Bộ lọc có thu hẹp phạm vi không.
 *
 * `status: 'all'` KHÔNG tính là filter — nó là mặc định, không loại bỏ dòng nào. Tính nó vào là
 * phá luôn tác dụng của chốt chặn: mọi request đều "có filter".
 */
export function hasAnyFilter(f: LogFilters): boolean {
  return (
    f.sourceKinds.length > 0 ||
    f.steps.length > 0 ||
    f.model !== '' ||
    f.owner !== '' ||
    f.status !== 'all' ||
    f.errorKind !== '' ||
    f.fromUtc !== null ||
    f.toUtc !== null
  );
}

/**
 * Bộ lọc dùng được cho lệnh XOÁ chưa — `null` = KHÔNG ĐƯỢC PHÉP xoá.
 *
 * Trả null thay vì ném để caller (route và chế độ đếm thử) buộc phải xử lý cùng một chỗ, và để
 * self-check khoá được bất biến này mà không cần dựng request.
 */
export function deleteFiltersOrNull(f: LogFilters): LogFilters | null {
  return hasAnyFilter(f) ? f : null;
}

/** Kẹp `limit` về [1, MAX_LOG_LIMIT]. Tham số rác → mặc định, không ném. */
export function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOG_LIMIT;
  return Math.min(Math.floor(n), MAX_LOG_LIMIT);
}

/** Con trỏ phân trang: row_id của dòng cuối trang trước. Rác → null (trang đầu). */
export function parseCursor(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
