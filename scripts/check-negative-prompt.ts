/**
 * Self-check negative prompt gửi kèm khi gen video livestream (lib/livestream/refImages.ts).
 *
 * Vì sao cần: trường này có BA trạng thái chứ không phải hai, và cách viết tắt tự nhiên nhất
 * (`override ?? DEFAULT`) làm hỏng đúng một trong ba — xoá sạch ô để TẮT negative prompt sẽ bị
 * hiểu thành "chưa đặt" rồi quay về mặc định, nghĩa là không ai tắt được. Route PATCH cũng phải
 * giữ nguyên chuỗi rỗng thay vì ép về null như 2 prompt override khác.
 *
 * Chạy: npx tsx scripts/check-negative-prompt.ts
 */
import assert from 'node:assert';
import { resolveNegativePrompt } from '../lib/livestream/refImages';
import { LIVESTREAM_DEFAULT_NEGATIVE_PROMPT } from '../lib/livestream/promptDefaults';

const DEF = LIVESTREAM_DEFAULT_NEGATIVE_PROMPT;

// 1. Chưa đụng tới (job cũ, cột NULL sau ALTER TABLE) → mặc định. Đây là ca của MỌI job đã tồn tại.
assert.strictEqual(
  resolveNegativePrompt({ negativePromptOverride: null }, DEF),
  DEF,
  'null phải rơi về negative prompt mặc định'
);

// 2. Mr.D xoá sạch ô rồi lưu = CHỦ ĐỘNG tắt hẳn → phải trả rỗng, KHÔNG được quay về mặc định.
assert.strictEqual(
  resolveNegativePrompt({ negativePromptOverride: '' }, DEF),
  '',
  'chuỗi rỗng là tắt hẳn, không được rơi về mặc định'
);
assert.strictEqual(
  resolveNegativePrompt({ negativePromptOverride: '   \n  ' }, DEF),
  '',
  'ô chỉ có khoảng trắng cũng là tắt hẳn'
);

// 3. Có nội dung → dùng đúng nội dung đó, đã trim.
assert.strictEqual(
  resolveNegativePrompt({ negativePromptOverride: '  extra hands, blurry  ' }, DEF),
  'extra hands, blurry',
  'override có nội dung phải được dùng nguyên (đã trim)'
);

// 4. Mặc định phải phủ đúng các lỗi mà SCRIPT_QA_SYSTEM_PROMPT đang đi bắt SAU khi sinh script —
//    đó là toàn bộ lý do tồn tại của lớp chặn này. Thiếu nhóm nào là hở đúng nhóm đó.
for (const must of [
  'extra hands',      // NHÓM 1 rule 3 — thao tác quá 2 tay
  'three hands',
  'deformed fingers',
  'duplicated product', // rule 6 — sản phẩm tự nhân bản
  'product changing color', // rule 4 — đổi màu giữa cảnh
  'floating product', // rule 1 — sản phẩm tự bay
  'hands passing through objects', // rule 2 — tay xuyên vật thể
  'standing up',      // rule 8 — MC đứng dậy rời ghế
  'second person',    // livestream chỉ có đúng 1 người dẫn
  'subtitles',        // Veo hay tự chèn phụ đề
]) {
  assert.ok(DEF.includes(must), `negative prompt mặc định phải chặn "${must}"`);
}

// 5. Định dạng: là 1 dòng các cụm ngăn bởi dấu phẩy (appendNegativePrompt ghép thành "Avoid: ...").
//    Xuống dòng giữa chừng dễ làm Veo hiểu nhầm phần sau là chỉ dẫn mới.
assert.ok(!DEF.includes('\n'), 'negative prompt mặc định phải nằm trên 1 dòng');
assert.ok(DEF.trim() === DEF, 'negative prompt mặc định không được thừa khoảng trắng đầu/cuối');

console.log('✓ check-negative-prompt: tất cả assert pass');
