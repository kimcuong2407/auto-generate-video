/**
 * Self-check: phép đếm của thanh tiến độ gen ảnh (Bước 3 luồng Video Review).
 *
 * Vì sao cần: đây là logic đếm thuần, sai thì KHÔNG có exception nào — chỉ là con số hiển thị
 * lệch, mà Mr.D lại tin nó để quyết định "gen xong chưa, có cần bấm lại không". Ba ca dễ sai:
 *   - Ảnh chưa có prompt bị đếm vào hàng chờ → thanh đứng mãi ở "1 chờ" mà không bao giờ chạy,
 *     vì route gen hàng loạt lọc bỏ ảnh không prompt (xem generate-backgrounds/route.ts).
 *   - Chia cho 0 khi project chưa có ảnh nào → percent = NaN → style width="NaN%".
 *   - Ảnh lỗi không tính là "đã xong" → thanh kẹt dưới 100% vĩnh viễn dù loạt gen đã dừng hẳn,
 *     Mr.D ngồi đợi một thứ không còn chạy.
 *
 * Chạy: npm run check:storyboard-progress
 */
import assert from 'node:assert/strict';
import { computeProgress, describeNothingToGenerate } from '../components/steps/StoryboardStep';
import type { StoryboardImage, StoryboardStatus } from '../lib/types';

function img(status: StoryboardStatus, prompt = 'có prompt'): StoryboardImage {
  return {
    sceneId: `s-${Math.random().toString(36).slice(2, 8)}`,
    prompt,
    status,
    imagePath: null,
    imageUrl: null,
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
  } as StoryboardImage;
}

// --- 1. Mảng rỗng: không hiện, không NaN ---
{
  const r = computeProgress([]);
  assert.equal(r.visible, false, 'project chưa có ảnh nào thì không hiện thanh tiến độ');
  assert.equal(r.percent, 0, 'percent phải là 0, KHÔNG được NaN (style width="NaN%" vỡ layout)');
  assert.ok(Number.isFinite(r.percent), 'percent phải là số hữu hạn');
}

// --- 2. Chưa bắt đầu: tất cả idle → không hiện ---
{
  const r = computeProgress([img('idle'), img('idle')]);
  assert.equal(r.visible, false, 'chưa gen ảnh nào thì không hiện thanh');
  assert.equal(r.waiting, 2);
}

// --- 3. Đang chạy song song: giữ đúng object để hiện tên cảnh ---
{
  const r = computeProgress([img('generating'), img('generating'), img('idle'), img('done')]);
  assert.equal(r.visible, true);
  assert.equal(r.running.length, 2, 'phải giữ đủ 2 ảnh đang gen (chạy song song, xem STORYBOARD_MAX_CONCURRENT)');
  assert.equal(r.waiting, 1);
  assert.equal(r.finished, 1);
  assert.equal(r.percent, 25, '1/4 xong = 25%');
}

// --- 4. Ảnh KHÔNG có prompt không được đếm vào hàng chờ ---
{
  const r = computeProgress([img('generating'), img('idle', ''), img('idle', '   ')]);
  assert.equal(
    r.waiting,
    0,
    'ảnh chưa có prompt bị route gen hàng loạt lọc bỏ — đếm vào hàng chờ là hứa một thứ không bao giờ chạy'
  );
}

// --- 5. Ảnh lỗi tính là ĐÃ XONG: loạt gen đã dừng, thanh phải chạy hết ---
{
  const r = computeProgress([img('done'), img('failed'), img('done')]);
  assert.equal(r.failed, 1);
  assert.equal(r.finished, 3, 'done + failed = đã xử lý xong, không còn gì chạy');
  assert.equal(r.percent, 100, 'không còn ảnh nào chạy thì thanh phải đầy, kể cả khi có lỗi');
  assert.equal(r.running.length, 0);
}

// --- 6. Xong sạch ---
{
  const r = computeProgress([img('done'), img('done')]);
  assert.equal(r.percent, 100);
  assert.equal(r.visible, true, 'gen xong rồi vẫn hiện để Mr.D biết loạt vừa chạy đã hoàn tất');
}

// --- 7. Lý do "không gen được": phải khớp ĐÚNG bộ lọc của route ---
// Ca thật: 6/7 ảnh background prompt rỗng → route lọc sạch, loạt gen kết thúc ngay, người bấm
// không nhận được lý do nào ("bấm gen background tất cả nhưng không có gì xảy ra").
{
  // Có ít nhất 1 ảnh chạy được → KHÔNG chặn.
  assert.equal(
    describeNothingToGenerate('background', [img('idle'), img('idle', '')]),
    null,
    'còn ảnh có prompt thì phải cho gen, chặn là chặn nhầm'
  );
  assert.equal(
    describeNothingToGenerate('background', [img('failed'), img('done')]),
    null,
    'ảnh failed có prompt vẫn nằm trong loạt gen (route nhận idle|failed)'
  );

  // Thiếu prompt → nêu đúng số lượng và tên nút cần bấm.
  const missing = describeNothingToGenerate('background', [
    img('done'),
    img('idle', ''),
    img('idle', '   '),
  ]);
  assert.ok(missing, 'toàn ảnh không prompt thì phải chặn kèm lý do');
  assert.match(missing!, /2\/3/, 'phải nói rõ bao nhiêu ảnh thiếu prompt');
  assert.match(missing!, /Sinh prompt background/, 'phải chỉ đúng nút cần bấm tiếp');

  // Nút storyboard có nhãn khác — chỉ sai nút là Mr.D đi tìm một nút không tồn tại.
  const missingSb = describeNothingToGenerate('storyboard', [img('idle', '')]);
  assert.ok(missingSb && !missingSb.includes('background'), 'loạt storyboard không được chỉ sang nút background');

  // Đã xong hết → nói rõ là xong, không phải lỗi.
  const allDone = describeNothingToGenerate('background', [img('done'), img('done')]);
  assert.ok(allDone && /đã gen xong/.test(allDone), 'xong hết thì báo xong, đừng báo như lỗi');

  // Đang chạy dở → bảo chờ, không bảo thiếu prompt.
  const running = describeNothingToGenerate('background', [img('generating')]);
  assert.ok(running && /đang gen dở/.test(running), 'ảnh đang chạy thì báo chờ, không báo thiếu prompt');

  // Chưa có ảnh nào (chưa duyệt kịch bản).
  const empty = describeNothingToGenerate('background', []);
  assert.ok(empty && /Bước 2/.test(empty), 'chưa có ảnh nào thì chỉ về Bước 2');
}

console.log('✅ check-storyboard-progress: 7/7 pass');
