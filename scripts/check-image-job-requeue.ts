/**
 * Self-check cho nhánh requeue job gen ảnh ChatGPT.
 *
 * Vì sao cần: tab ChatGPT chỉ chạy được 1 job một lúc, nên khi bấm "Gen tất cả" ở Bước 3 thì
 * extension claim job thứ 2 trong lúc tab còn bận và bị từ chối. Trước đây nhánh đó gọi
 * failJob → job chết vĩnh viễn: gen 7 ảnh chỉ chạy 1, 6 cái failed ngay với "đang chạy một job
 * khác trong tab này" (đã xảy ra thật trên project hop-dung-do-nha-bep-...-2fa916, 10/09/2026).
 *
 * Điều dễ trôi nhất là phân biệt "chưa tới lượt" với "hỏng thật" — nhầm một trong hai chiều đều
 * tệ: nhầm sang fail thì mất job như cũ, nhầm sang requeue thì lỗi thật bị giấu và job lặp vô
 * hạn. Nên check này khoá đúng cái bảng quyết định đó.
 *
 * Chạy: npx tsx scripts/check-image-job-requeue.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MAX_REQUEUE_ATTEMPTS = 30;

type Action = 'requeue' | 'fail' | 'finish';

/** Bản rút gọn của nhánh quyết định trong app/api/chatgpt-image/worker/route.ts POST. */
function decide(body: { error?: string; imageBase64?: string; retryable?: boolean }, attempts: number): Action {
  if (body.error || !body.imageBase64) {
    if (body.retryable && attempts < MAX_REQUEUE_ATTEMPTS) return 'requeue';
    return 'fail';
  }
  return 'finish';
}

// 1. Tab bận (retryable) + còn lượt → requeue, KHÔNG được đánh hỏng.
assert.equal(decide({ error: 'đang chạy một job khác trong tab này', retryable: true }, 1), 'requeue');
assert.equal(decide({ error: 'tab bận', retryable: true }, MAX_REQUEUE_ATTEMPTS - 1), 'requeue');

// 2. Lỗi THẬT (không retryable) → fail ngay, không được giấu bằng requeue.
assert.equal(decide({ error: 'Chạy script trong tab thất bại: tab đã đóng' }, 0), 'fail');
assert.equal(decide({ error: 'ChatGPT từ chối prompt' }, 0), 'fail');

// 3. Hết trần → fail, nếu không sẽ lặp vô hạn khi cờ busy trong trang không bao giờ được nhả.
assert.equal(decide({ error: 'tab bận', retryable: true }, MAX_REQUEUE_ATTEMPTS), 'fail');
assert.equal(decide({ error: 'tab bận', retryable: true }, MAX_REQUEUE_ATTEMPTS + 5), 'fail');

// 4. Không có ảnh mà cũng không có error → vẫn phải fail (không được coi là thành công).
assert.equal(decide({}, 0), 'fail');

// 5. Có ảnh → finish.
assert.equal(decide({ imageBase64: 'iVBORw0KG...' }, 0), 'finish');

// 6. requeueJob phải chỉ đụng job đang 'running' — nếu không, kết quả về muộn sẽ hồi sinh job
//    đã bị reap và nó chạy lại lần nữa.
{
  const src = fs.readFileSync('lib/chatgptImage/jobStore.ts', 'utf8');
  const fn = src.slice(src.indexOf('export async function requeueJob'), src.indexOf('export async function failJob'));
  assert.match(fn, /status:\s*'queued'/, 'phải trả về trạng thái queued');
  assert.match(fn, /eq\(chatgptImageJobs\.status,\s*'running'\)/, 'PHẢI có điều kiện chỉ đụng job running');
  assert.match(fn, /startedAt:\s*null/, 'quay về queued thì startedAt cũ không còn nghĩa');
  assert.doesNotMatch(fn, /attempts:/, 'không được reset attempts — nó là trần chống lặp vô hạn');
}

// 7. Cả 2 bản extension đều phải khai cờ retryable, nếu không bản thiếu vẫn hỏng như cũ.
for (const p of ['extension-chatgpt/imageJob.js', 'extension-chatgpt-standalone/imageJob.js']) {
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /retryable:\s*true/, `${p} phải khai retryable khi tab bận`);
}
// 8. …và cả 2 background.js phải CHUYỂN TIẾP cờ đó lên server.
for (const p of ['extension-chatgpt/background.js', 'extension-chatgpt-standalone/background.js']) {
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /retryable/, `${p} phải chuyển tiếp cờ retryable`);
  assert.match(src, /postResult\(base,\s*\{\s*jobId:\s*job\.id,\s*error:\s*msg,\s*retryable\s*\}\)/, `${p} phải gửi retryable kèm error`);
}

console.log('✅ check-image-job-requeue: 8/8 pass');
