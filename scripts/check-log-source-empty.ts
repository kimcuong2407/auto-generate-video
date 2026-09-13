/**
 * Self-check: lọc log theo source_kind RỖNG phải hoạt động, và phải khác "không lọc".
 *
 * Vì sao cần khoá bất biến này: sau migration 0025, toàn bộ log cũ mang source_kind = '' (DEFAULT
 * của cột mới). Đối chiếu DB local `video` ngày 2026-09-13: 51/51 dòng ai_call_logs đều ''. Nếu
 * đường lọc làm rụng '' thì bấm chip "không rõ (log cũ)" ra 0 dòng dù bảng đầy dữ liệu — triệu
 * chứng giống hệt tính năng hỏng, và đó chính là thứ đã tốn một buổi để lần ra lần trước.
 *
 * Bất biến thứ hai quan trọng không kém: [''] PHẢI tính là CÓ lọc. hasAnyFilter là chốt chặn duy
 * nhất của lệnh xoá — coi [''] là "không lọc" thì một cú bấm xoá sẽ quét sạch bảng.
 */
import assert from 'node:assert/strict';
import { parseLogFilters, hasAnyFilter, deleteFiltersOrNull } from '../lib/logs/filters';
import { isFilterableSourceKind, isSourceKind, FILTERABLE_SOURCE_KINDS } from '../lib/logs/sourceKind';

function filtersOf(qs: string) {
  return parseLogFilters(new URLSearchParams(qs));
}

// --- 1. '' đi xuyên qua parse, KHÔNG bị .filter(Boolean) làm rụng ---
assert.deepEqual(filtersOf('sourceKind=').sourceKinds, [''], "sourceKind= phải parse thành ['']");

// --- 2. Tham số VẮNG MẶT khác hẳn tham số rỗng ---
assert.deepEqual(filtersOf('').sourceKinds, [], 'không có tham số = không lọc loại');

// --- 3. Lọc hỗn hợp giữ đủ cả '' lẫn giá trị thật ---
assert.deepEqual(
  filtersOf('sourceKind=,product-review').sourceKinds,
  ['', 'product-review'],
  'lọc hỗn hợp phải giữ cả hai'
);

// --- 4. Giá trị rác vẫn bị loại, '' thì không ---
assert.deepEqual(filtersOf('sourceKind=linh-tinh').sourceKinds, [], 'giá trị lạ phải bị loại');
assert.deepEqual(
  filtersOf('sourceKind=,linh-tinh').sourceKinds,
  [''],
  'giữ rỗng nhưng vẫn loại giá trị lạ'
);

// --- 4b. Dấu phẩy thừa gộp về đúng MỘT '' (xem check-log-delete-guard: đây là chuyện an toàn) ---
assert.deepEqual(filtersOf('sourceKind=,,,').sourceKinds, [''], 'phải khử trùng lặp');
assert.deepEqual(
  filtersOf('sourceKind=,product-review,product-review').sourceKinds,
  ['', 'product-review'],
  'khử trùng lặp cả giá trị thật'
);

// --- 5. [''] PHẢI tính là có lọc → chốt chặn xoá không bị vô hiệu ---
assert.equal(hasAnyFilter(filtersOf('sourceKind=')), true, "[''] phải tính là CÓ lọc");
assert.notEqual(
  deleteFiltersOrNull(filtersOf('sourceKind=')),
  null,
  "[''] phải xoá được (đây là cách dọn log cũ)"
);
// Ngược lại: hoàn toàn không lọc thì KHÔNG được phép xoá.
assert.equal(deleteFiltersOrNull(filtersOf('')), null, 'không lọc gì thì cấm xoá');

// --- 6. Hai hàm kiểm tra giữ đúng vai: isSourceKind canh chỗ GHI, isFilterable canh chỗ LỌC ---
assert.equal(isSourceKind(''), false, "isSourceKind('') phải false — cấm ghi log thiếu nhãn");
assert.equal(isFilterableSourceKind(''), true, "isFilterableSourceKind('') phải true");

// --- 7. UI phải render được chip cho '' ---
assert.ok(FILTERABLE_SOURCE_KINDS.includes(''), 'danh sách chip phải có ""');
assert.equal(FILTERABLE_SOURCE_KINDS.length, 4, 'phải đủ 3 loại thật + 1 "không rõ"');

console.log('✅ check-log-source-empty: lọc source_kind rỗng OK, chốt chặn xoá còn nguyên');
