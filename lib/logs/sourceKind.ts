/**
 * Loại nguồn của một dòng log — trả lời câu "lượt này thuộc dây chuyền nào".
 *
 * Vì sao cần cột riêng thay vì suy ra lúc đọc: hai luồng livestream V1/V2 hiện chỉ phân biệt được
 * bằng "job có row trong livestream_v2_inputs hay không" (xem lib/livestream/v2Store.ts). Suy ra
 * lúc đọc thì (a) mỗi truy vấn phải JOIN thêm, (b) job bị xoá là log mất nhãn, và (c) nhãn sẽ
 * phản ánh trạng thái HIỆN TẠI chứ không phải lúc chạy. Ghi thẳng lúc tạo log giữ đúng sự thật
 * của thời điểm đó — đấy mới là thứ dùng để truy vết.
 *
 * Khai báo MỘT chỗ duy nhất: 3 bảng + API filter + UI đều đọc từ đây, rải hằng ra nhiều file là
 * kiểu gì cũng có chỗ lệch rồi lọc mất dòng mà không ai thấy.
 */

/** '' KHÔNG nằm trong danh sách này: nó là giá trị của log GHI TRƯỚC khi có cột (xem bên dưới). */
export const SOURCE_KINDS = ['livestream-v1', 'livestream-v2', 'product-review'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Nhãn tiếng Việt cho UI. Bao gồm cả '' — log cũ ghi trước migration 0025.
 *
 * '' hiển thị "không rõ" chứ TUYỆT ĐỐI không đoán ngược từ job_slug/project_id: log livestream V1
 * và V2 cũ nằm lẫn nhau trong cùng cột job_slug, đoán ra là bịa một bằng chứng trông như thật.
 */
export const SOURCE_KIND_LABEL: Record<string, string> = {
  'livestream-v1': 'Livestream V1',
  'livestream-v2': 'Livestream V2',
  'product-review': 'Video Review',
  '': 'không rõ (log cũ)',
};

/**
 * Giá trị LỌC ĐƯỢC ở UI — gồm cả '' (log ghi trước migration 0025).
 *
 * Vì sao '' phải lọc được dù không nằm trong SOURCE_KINDS: sau khi 0025 chạy, TOÀN BỘ log cũ mang
 * source_kind = '' (DEFAULT của cột). Nếu chỉ cho lọc 3 giá trị kia thì bấm chip nào cũng ra 0
 * dòng trong khi bảng có dữ liệu — trông hệt như tính năng hỏng. Đối chiếu DB local `video`
 * 2026-09-13: 51/51 dòng ai_call_logs có source_kind = ''.
 */
export const FILTERABLE_SOURCE_KINDS = ['', ...SOURCE_KINDS] as const;

/** Giá trị đọc từ query string có hợp lệ không — dùng để lọc tham số API trước khi vào WHERE. */
export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

/**
 * Như isSourceKind nhưng CHẤP NHẬN '' — dùng cho tham số lọc của tab /logs.
 *
 * Tách thành hàm riêng thay vì nới lỏng isSourceKind: isSourceKind đang canh chỗ GHI log (nơi ''
 * là giá trị không được phép ghi mới), nới nó ra là mở đường cho log mới ghi thiếu nhãn.
 */
export function isFilterableSourceKind(value: string): boolean {
  return value === '' || isSourceKind(value);
}
