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
import { computeProgress } from '../components/steps/StoryboardStep';
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

console.log('✅ check-storyboard-progress: 6/6 pass');
