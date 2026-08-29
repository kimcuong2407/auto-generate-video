/**
 * Self-check chọn ảnh gửi kèm khi GEN BACKGROUND (pickBackgroundRefEntries + resolveBackgroundPrompt).
 *
 * Hai thứ hỏng âm thầm ở đây:
 * 1. Job cũ (chưa từng tick chọn) phải giữ NGUYÊN hành vi tự chọn — nếu không, mọi job đang chạy
 *    đột ngột gen background với bộ ảnh rỗng.
 * 2. Nhãn ảnh sai → prompt nói model đang nhìn "ảnh sản phẩm" trong khi đó là ảnh mẫu, kết quả ra
 *    người lạ (đúng lớp bug đã sửa ở refLegendBlock).
 */
import assert from 'node:assert/strict';
import { pickBackgroundRefEntries, pickVisionRefEntries } from '../lib/livestream/refImages';
import { resolveBackgroundPrompt } from '../lib/livestream/backgroundGenerate';
import { BACKGROUND_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';

const job = {
  selectedRefImagePaths: ['inputs/p1.jpg', 'inputs/p2.jpg'],
  selectedModelImagePath: 'inputs/model.jpg',
  selectedBackgroundImagePath: 'inputs/bg.jpg',
  backgroundRefPaths: [] as string[],
};

// --- Chưa tick chọn gì → giữ nguyên hành vi tự chọn của pickVisionRefEntries ---
{
  const auto = pickBackgroundRefEntries(job);
  assert.deepEqual(auto, pickVisionRefEntries(job), 'rỗng phải rơi về lựa chọn tự động');
  assert.equal(auto[0].label, 'ảnh NGƯỜI MẪU/NGƯỜI DẪN', 'ảnh mẫu phải đứng đầu');
}

// --- Cột DB nullable: job cũ đọc ra undefined, không được crash ---
{
  const legacy = { ...job, backgroundRefPaths: undefined as unknown as string[] };
  const entries = pickBackgroundRefEntries(legacy);
  assert.deepEqual(entries, pickVisionRefEntries(job), 'undefined phải xử như rỗng');
}

// --- Đã tick chọn → dùng ĐÚNG danh sách đó, đúng thứ tự, nhãn đúng vai trò ---
{
  const picked = {
    ...job,
    backgroundRefPaths: ['inputs/model.jpg', 'inputs/p2.jpg', 'inputs/bgref-1.jpg'],
  };
  const entries = pickBackgroundRefEntries(picked);
  assert.equal(entries.length, 3, 'phải gửi đúng 3 ảnh đã tick, không thêm ảnh tự chọn');
  assert.deepEqual(
    entries.map((e) => e.rel),
    ['inputs/model.jpg', 'inputs/p2.jpg', 'inputs/bgref-1.jpg'],
    'giữ nguyên thứ tự người dùng tick'
  );
  assert.equal(entries[0].label, 'ảnh NGƯỜI MẪU/NGƯỜI DẪN');
  assert.equal(entries[1].label, 'ảnh SẢN PHẨM THẬT 1', 'ảnh sản phẩm phải được đánh số lại từ 1');
  assert.equal(entries[2].label, 'ảnh THAM CHIẾU BỐI CẢNH', 'ảnh upload riêng phải có nhãn riêng');
}

// --- Tick ảnh nền đang chọn → nhãn phải là BỐI CẢNH, không lẫn sang sản phẩm ---
{
  const entries = pickBackgroundRefEntries({ ...job, backgroundRefPaths: ['inputs/bg.jpg'] });
  assert.equal(entries[0].label, 'ảnh BỐI CẢNH/BACKGROUND');
}

// --- Bỏ tick hết → quay lại tự chọn, KHÔNG phải gửi 0 ảnh ---
{
  const entries = pickBackgroundRefEntries({ ...job, backgroundRefPaths: [] });
  assert.ok(entries.length > 0, 'bỏ tick hết phải quay về tự chọn, không gửi rỗng');
}

// --- Prompt: chưa lưu override → mặc định; đã lưu → dùng bản đã lưu ---
{
  assert.equal(resolveBackgroundPrompt({ backgroundPromptOverride: null }), BACKGROUND_SYSTEM_PROMPT);
  assert.equal(
    resolveBackgroundPrompt({ backgroundPromptOverride: '   ' }),
    BACKGROUND_SYSTEM_PROMPT,
    'chuỗi toàn khoảng trắng phải coi như chưa override'
  );
  assert.equal(
    resolveBackgroundPrompt({ backgroundPromptOverride: 'Prompt riêng của Mr.D' }),
    'Prompt riêng của Mr.D'
  );
}

console.log('✅ check-background-refs: OK');
