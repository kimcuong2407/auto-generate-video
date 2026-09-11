/**
 * Self-check: helper hiển thị thời gian UTC+7 (lib/format/datetime.ts).
 *
 * Vì sao cần — mỗi nhóm khoá một lỗi mà typecheck KHÔNG bắt và cũng không lộ khi bấm thử một lần
 * trên máy Mr.D (máy đã sẵn UTC+7 nên nhiều lỗi múi giờ trông như đúng):
 *
 * 1. Chuỗi từ DB không có 'Z' nhưng LÀ UTC. Quên gắn 'Z' thì new Date() hiểu theo giờ local →
 *    ĐÚNG trên máy Mr.D (+7), SAI 7 tiếng trên VPS (UTC). Lỗi chỉ lộ ở production.
 * 2. Hai dạng đầu vào (DB và ISO) phải cho CÙNG kết quả — hai đường code khác nhau dễ lệch nhau.
 * 3. Ca VẮT NGÀY: 18:30 UTC là 01:30 hôm SAU theo giờ VN. Off-by-one múi giờ chỉ lộ ở đây; test
 *    bằng giờ giữa trưa sẽ pass cả khi code sai.
 * 4. vnDayToUtcSql phải trừ đi 7 tiếng, nếu không bộ lọc from/to bỏ sót đúng 7 tiếng dữ liệu.
 * 5. Quét mã nguồn: không còn chỗ nào hiển thị thời gian bằng toLocaleString không timeZone —
 *    đây là thứ chặn TÁI PHÁT, vì thêm một trang mới rồi copy-paste dòng cũ là rất dễ.
 *
 * Không đụng DB, không đụng mạng: chỉ hàm thuần + đọc file.
 *
 * Chạy: npm run check:log-datetime
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DISPLAY_TZ, fullTimeVn, shortTimeVn, vnDayToUtcSql } from '../lib/format/datetime';

// --- 1. Chuỗi DB (không Z, là UTC) phải được cộng đúng +7 ---
assert.equal(
  shortTimeVn('2026-09-03 14:32:07.123'),
  '21:32:07 03/09',
  'chuỗi DB phải được hiểu là UTC rồi đổi sang +7 (14:32 UTC = 21:32 VN)'
);

// --- 2. Dạng ISO cho CÙNG kết quả với dạng DB ---
assert.equal(
  shortTimeVn('2026-09-03T14:32:07.123Z'),
  shortTimeVn('2026-09-03 14:32:07.123'),
  'hai dạng đầu vào cùng một mốc thời gian phải hiện y hệt nhau'
);

// --- 3. Ca VẮT NGÀY — chỗ duy nhất lộ off-by-one múi giờ ---
assert.equal(
  shortTimeVn('2026-09-03 18:30:00'),
  '01:30:00 04/09',
  '18:30 UTC là 01:30 NGÀY HÔM SAU theo giờ VN — ngày phải nhảy sang 04/09'
);
// Vắt luôn cả tháng: 30/09 18:30 UTC → 01:30 01/10.
assert.equal(
  shortTimeVn('2026-09-30 18:30:00'),
  '01:30:00 01/10',
  'vắt ngày kéo theo vắt tháng'
);

// --- 4. fullTimeVn: cùng mốc, thêm năm ---
assert.equal(fullTimeVn('2026-09-03 14:32:07.123'), '03/09/2026 21:32:07');
assert.equal(fullTimeVn('2026-12-31 17:00:00'), '01/01/2027 00:00:00', 'vắt sang năm mới');

// --- 5. vnDayToUtcSql: ngày VN → mốc UTC cho WHERE ---
assert.equal(
  vnDayToUtcSql('2026-09-03'),
  '2026-09-02 17:00:00.000',
  '00:00 ngày 03/09 giờ VN = 17:00 ngày 02/09 UTC'
);
assert.equal(
  vnDayToUtcSql('2026-09-03', true),
  '2026-09-03 16:59:59.999',
  'cuối ngày 03/09 giờ VN = 16:59:59.999 cùng ngày UTC'
);
assert.equal(vnDayToUtcSql('03/09/2026'), null, 'dạng sai phải trả null để caller bỏ qua filter');
assert.equal(vnDayToUtcSql(''), null);

// --- 6. Đầu vào hỏng trả nguyên văn, KHÔNG ném ---
// Một chuỗi lạ trong DB không đáng làm vỡ cả bảng log.
assert.equal(shortTimeVn('không phải ngày'), 'không phải ngày');
assert.equal(fullTimeVn(''), '');

// --- 7. Múi giờ khai báo MỘT chỗ ---
assert.equal(DISPLAY_TZ, 'Asia/Ho_Chi_Minh');

// --- 8. KHÔNG còn chỗ nào hiển thị thời gian bằng toLocaleString không timeZone ---
// Chỉ soi `new Date(...).toLocale*` — đó là dạng format THỜI GIAN. Số/tiền cũng dùng
// toLocaleString('vi-VN') nhưng gọi trên number nên không dính, và KHÔNG được đổi.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const file of [...walk('app'), ...walk('components')]) {
  const src = fs.readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/new Date\([^)]*\)\.toLocale/.test(line)) offenders.push(`${file}:${i + 1}`);
  });
}
assert.deepEqual(
  offenders,
  [],
  `còn ${offenders.length} chỗ format thời gian theo múi giờ MÁY thay vì UTC+7 — dùng ` +
    `fullTimeVn/shortTimeVn (lib/format/datetime.ts):\n  ${offenders.join('\n  ')}`
);

console.log(
  `✅ check-log-datetime: OK (cộng đúng +7 kể cả ca vắt ngày/tháng/năm, ` +
    `vnDayToUtcSql lùi đúng 7 tiếng, không còn chỗ nào format theo múi giờ máy)`
);
