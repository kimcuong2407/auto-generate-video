/**
 * Self-check cache-buster cho URL video final (lib/livestream/mediaUrl.ts).
 *
 * Vì sao cần: key trên R2 cố định (`final.mp4`) và bị ghi đè mỗi lần ghép, nên URL không đổi.
 * Trình duyệt cache thẻ <video> rất dai → ghép lại xong vẫn xem bản cũ dù R2 đã đúng (xác minh
 * thực tế: md5 local == etag R2, chỉ client là cũ). Tham số `v` theo finishedAt là thứ ép tải lại.
 *
 * Chạy: npx tsx scripts/check-media-url-version.ts
 */
import assert from 'node:assert';
import { withVersion } from '../lib/livestream/mediaUrl';

const R2 = 'https://video-r2.homebox.vn/livestream/abc/final.mp4';
const T1 = '2026-08-27T01:58:38.677Z';
const T2 = '2026-08-27T03:10:00.000Z';

// Ghép lần 1 → URL mang mốc phiên bản.
const u1 = withVersion(R2, T1);
assert.ok(u1!.startsWith(R2), 'giữ nguyên URL gốc, chỉ thêm tham số');
assert.ok(u1!.includes('?v='), 'phải gắn tham số v');

// CỐT LÕI: ghép lại (finishedAt đổi) → URL PHẢI khác, nếu không trình duyệt phát bản cũ.
const u2 = withVersion(R2, T2);
assert.notStrictEqual(u1, u2, 'ghép lại phải cho URL khác để phá cache');

// Cùng một bản ghép → URL ỔN ĐỊNH (không random), để cache vẫn phát huy tác dụng giữa các lần render.
assert.strictEqual(withVersion(R2, T1), u1, 'cùng finishedAt phải cho cùng URL, không được random');

// Route media local đã có sẵn query → nối bằng & chứ không phải ? (nếu không sẽ hỏng URL).
const local = withVersion('/api/livestream/abc/media/outputs/final.mp4?raw=1', T1);
assert.ok(local!.includes('?raw=1&v='), 'URL đã có query thì nối bằng &');
assert.strictEqual((local!.match(/\?/g) || []).length, 1, 'không được có 2 dấu ?');

// Chưa ghép xong (finishedAt null) → trả URL gốc, không gắn "v=null".
assert.strictEqual(withVersion(R2, null), R2, 'chưa có finishedAt thì giữ nguyên URL');
assert.ok(!withVersion(R2, null)!.includes('v='), 'không được gắn v rỗng');

// finishedAt rác → không làm hỏng URL.
assert.strictEqual(withVersion(R2, 'không-phải-ngày'), R2, 'timestamp không parse được thì giữ nguyên');

// Chưa có URL → null, caller tự ẩn player (không dựng thẻ <video src="null">).
assert.strictEqual(withVersion(null, T1), null, 'không có URL thì trả null');
assert.strictEqual(withVersion(undefined, T1), null, 'undefined cũng trả null');
assert.strictEqual(withVersion('', T1), null, 'chuỗi rỗng trả null');

console.log('✓ check-media-url-version: tất cả assert pass');
