/**
 * Self-check: quy tắc chọn người dẫn khi job KHÔNG có ảnh mẫu.
 *
 * Yêu cầu của Mr.D: có ảnh mẫu → tả đúng người trong ảnh; không có ảnh mẫu → mặc định CỐ ĐỊNH
 * là nữ Việt Nam ~25 tuổi, trắng trẻo, xinh xắn.
 *
 * Vì sao cần check: trước đây prompt chỉ nói "chọn phương án TRUNG TÍNH" nên LLM tự suy diễn giới
 * tính theo loại sản phẩm (túi chạy bộ → tự chọn nữ, đồ nghề → tự chọn nam) — không đoán trước
 * được. Check này khoá lại cả 2 nhánh, và khoá THỨ TỰ ƯU TIÊN: ảnh mẫu phải thắng mặc định.
 *
 * Chạy: npx tsx scripts/check-default-host.ts
 */
import assert from 'node:assert';
import { STAGE_BIBLE_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';
import { formatStageBibleBlock } from '../lib/livestream/stageBible';

const p = STAGE_BIBLE_SYSTEM_PROMPT;

// --- nhánh CÓ ảnh mẫu: ảnh là nguồn sự thật, thắng mặc định ---
assert.ok(p.includes('CÓ ảnh người mẫu'), 'phải nêu rõ nhánh có ảnh mẫu');
assert.ok(
  p.replace(/\s+/g, ' ').includes('thắng mọi mặc định bên dưới'),
  'phải nói rõ ảnh mẫu THẮNG mặc định — nếu không LLM có thể áp mặc định nữ đè lên ảnh mẫu nam'
);

// --- nhánh KHÔNG có ảnh mẫu: mặc định cố định theo yêu cầu Mr.D ---
for (const tu of ['nữ', 'Việt Nam', '25 tuổi', 'trắng trẻo', 'xinh xắn']) {
  assert.ok(p.includes(tu), `mặc định người dẫn phải nêu "${tu}"`);
}
// Prompt xuống dòng giữa câu nên so trên bản đã gộp khoảng trắng, không so chuỗi thô.
const flat = p.replace(/\s+/g, ' ');
assert.ok(
  flat.includes('KHÔNG suy diễn giới tính theo loại sản phẩm'),
  'phải cấm suy diễn giới tính theo mặt hàng — đây là thứ khiến túi chạy bộ luôn ra người dẫn nữ tự phát'
);
assert.ok(p.includes('giọng NỮ trẻ'), 'không có ảnh mẫu thì voice phải khớp mặc định nữ');

// --- thứ tự: nhánh ảnh mẫu phải đứng TRƯỚC nhánh mặc định ---
assert.ok(
  p.indexOf('CÓ ảnh người mẫu') < p.indexOf('KHÔNG có ảnh người mẫu'),
  'nhánh có ảnh mẫu phải đứng trước — LLM đọc tuần tự, mặc định đặt trước sẽ bị áp nhầm'
);

// --- khoá giới tính vẫn hoạt động cho bible mặc định (nữ) ---
const block = formatStageBibleBlock({
  host: 'Nữ, người Việt Nam, khoảng 25 tuổi, da trắng trẻo, gương mặt xinh xắn, tóc đen dài',
  scene: 'góc phòng live tại nhà',
  camera: 'trung cảnh ngang tầm mắt',
  voice: 'Nữ trẻ, giọng vui tươi',
  wardrobeLock: '',
  modelImagePath: null,
  inputsFingerprint: 'fp',
});
assert.ok(
  block.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NỮ'),
  'bible mặc định (nữ) vẫn phải được khoá giới tính ở dòng đầu như bible từ ảnh mẫu'
);

console.log('✓ check-default-host: tất cả assert pass');
