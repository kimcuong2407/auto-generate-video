/**
 * Self-check: rào chắn của tính năng XOÁ LOG.
 *
 * Vì sao đây là check quan trọng nhất của cả tính năng tab log: từ khi bỏ cắt tỉa, DELETE là
 * đường DUY NHẤT làm mất log, và mất là vĩnh viễn. Ca hỏng tệ nhất không phải Mr.D bấm nhầm —
 * mà là một lỗi fetch ở UI làm mọi filter thành undefined, request đi tới với bộ lọc RỖNG, rồi
 * DELETE không điều kiện quét sạch bảng. Không có lỗi nào báo; chỉ có log biến mất.
 *
 * Vì thế `deleteFiltersOrNull` phải trả null cho MỌI dạng "rỗng", kể cả dạng trông như có filter:
 * mảng rỗng, chuỗi toàn khoảng trắng, ngày sai định dạng, status mặc định.
 *
 * Kiểm hàm thuần (không cần DB) + quét route để chắc hàm đó THỰC SỰ được dùng — hàm đúng mà route
 * không gọi thì vô nghĩa.
 *
 * Chạy: npm run check:log-delete-guard
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LOG_LIMIT,
  MAX_LOG_LIMIT,
  deleteFiltersOrNull,
  hasAnyFilter,
  parseCursor,
  parseLimit,
  parseLogFilters,
} from '../lib/logs/filters';

const q = (s: string) => parseLogFilters(new URLSearchParams(s));

// --- 1. Bộ lọc RỖNG tuyệt đối không được phép xoá ---
assert.equal(deleteFiltersOrNull(q('')), null, 'query rỗng mà cho xoá là quét sạch bảng');
assert.equal(deleteFiltersOrNull(q('status=all')), null, 'status=all là mặc định, không phải filter');

// Các dạng "trông như có filter" nhưng thực chất rỗng — đây là chỗ dễ lọt nhất.
assert.equal(deleteFiltersOrNull(q('sourceKind=')), null, 'csv rỗng');
assert.equal(deleteFiltersOrNull(q('sourceKind=,,,')), null, 'csv toàn dấu phẩy');
assert.equal(deleteFiltersOrNull(q('sourceKind=livestream-v9')), null, 'giá trị lạ bị loại → còn rỗng');
assert.equal(deleteFiltersOrNull(q('owner=%20%20')), null, 'owner toàn khoảng trắng');
assert.equal(deleteFiltersOrNull(q('model=%20')), null, 'model toàn khoảng trắng');
assert.equal(deleteFiltersOrNull(q('step=')), null, 'step rỗng');
assert.equal(deleteFiltersOrNull(q('from=hom-qua')), null, 'ngày sai định dạng phải bị loại, không thành filter');
assert.equal(deleteFiltersOrNull(q('from=03/09/2026')), null, 'ngày kiểu VN không phải YYYY-MM-DD');

// --- 2. Bộ lọc THẬT thì phải cho phép ---
for (const query of [
  'sourceKind=product-review',
  'step=review_script',
  'owner=abc-123',
  'model=gpt-5',
  'status=error',
  'errorKind=quota',
  'from=2026-09-01',
  'to=2026-09-30',
]) {
  assert.ok(deleteFiltersOrNull(q(query)) !== null, `"${query}" là filter thật, phải cho xoá`);
  assert.ok(hasAnyFilter(q(query)), `"${query}" phải được coi là có filter`);
}

// --- 3. from/to quy đổi từ giờ VN sang UTC ---
// Không quy đổi thì bộ lọc lệch 7 tiếng: xoá/đọc nhầm dải dữ liệu, âm thầm.
assert.equal(q('from=2026-09-03').fromUtc, '2026-09-02 17:00:00.000');
assert.equal(q('to=2026-09-03').toUtc, '2026-09-03 16:59:59.999', 'to phải bao trọn ngày VN');

// --- 4. Trần limit: bảng vô hạn nên đây là thứ duy nhất chặn kéo cả bảng ---
assert.equal(parseLimit(null), DEFAULT_LOG_LIMIT);
assert.equal(parseLimit('0'), DEFAULT_LOG_LIMIT, 'limit=0 vô nghĩa → mặc định');
assert.equal(parseLimit('-5'), DEFAULT_LOG_LIMIT);
assert.equal(parseLimit('abc'), DEFAULT_LOG_LIMIT);
assert.equal(parseLimit('999999'), MAX_LOG_LIMIT, 'phải kẹp về trần cứng, không nghe client');
assert.equal(parseLimit('10'), 10);

// --- 5. Cursor: rác không được thành trang 1 cách im lặng sai ---
assert.equal(parseCursor('abc'), null);
assert.equal(parseCursor('0'), null);
assert.equal(parseCursor('-1'), null);
assert.equal(parseCursor('12'), 12);

// --- 6. Route xoá phải THỰC SỰ dùng chốt trên ---
const routePath = path.join(process.cwd(), 'app/api/logs/delete/route.ts');
assert.ok(fs.existsSync(routePath), 'thiếu route xoá log');
const route = fs.readFileSync(routePath, 'utf8');

assert.match(route, /deleteFiltersOrNull/, 'route PHẢI dùng deleteFiltersOrNull, không tự dựng WHERE');
assert.match(
  route,
  /confirm !== 'XOA'/,
  "phải đòi gõ đúng chữ 'XOA' — confirm:true quá dễ gửi nhầm từ code"
);
// Cả hai đường (đếm thử và xoá thật) phải đi qua CÙNG một hàm dựng điều kiện, nếu không số hiện
// trong hộp xác nhận sẽ khác số thực xoá — xác nhận kiểu đó là xác nhận giả.
assert.match(route, /dryRun/, 'route phải có chế độ đếm thử cho hộp xác nhận');
// Mọi lời gọi .delete(...) phải có .where(...) đi kèm ngay sau. Đếm cặp thay vì dò chuỗi: lời gọi
// có thể xuống dòng (prettier), dò bằng một regex phẳng sẽ báo động giả đúng lúc code đang ĐÚNG.
const deleteCalls = (route.match(/\.delete\(/g) ?? []).length;
const deleteWithWhere = (route.match(/\.delete\([\s\S]{0,80}?\)\s*\.where\(/g) ?? []).length;
assert.ok(deleteCalls > 0, 'route xoá phải thực sự có lệnh DELETE');
assert.equal(
  deleteWithWhere,
  deleteCalls,
  `có ${deleteCalls - deleteWithWhere} lệnh DELETE thiếu .where() — sẽ quét sạch bảng`
);
// Và chốt cuối trong chính route: điều kiện rỗng thì từ chối, phòng khi hàm lọc bị sửa hỏng.
assert.match(
  route,
  /conditions\.length === 0/,
  'route phải tự kiểm điều kiện rỗng lần nữa trước khi xoá'
);

console.log(
  '✅ check-log-delete-guard: OK (bộ lọc rỗng ở mọi dạng đều bị chặn, limit có trần cứng, ' +
    'route đòi xác nhận và dùng chung điều kiện với đếm thử)'
);
