/**
 * Self-check: khối "sân khấu cố định" phải KHOÁ được giới tính người dẫn.
 *
 * Vì sao cần (ca thật, job production 825314): bible tả "Nam, khoảng 35-40 tuổi, đầu cạo gọn, đeo
 * kính" nhưng script sinh lúc 10:07 — SAU khi bible đó đã chốt — vẫn ra "người dẫn livestream nữ
 * khoảng 27 tuổi, tóc đuôi ngựa" ở 8/8 đoạn. Nguyên nhân: system prompt ra lệnh "BƯỚC 1 — tự chốt
 * người dẫn" dài dòng, còn câu huỷ lệnh nằm lọt thỏm ở CUỐI khối bible nên bị lấn át.
 *
 * Check này khoá lại: câu cấm giới tính phải nằm ở ĐẦU user prompt và nêu thẳng giới tính bị cấm.
 *
 * Ca thứ hai (job combo-100-khay): ảnh mẫu là nam nhưng script ra "young Vietnamese female
 * presenter" vì Mr.D đã TẮT khối sc_bible — câu cấm gói chung trong đó nên mất theo. Nay câu cấm
 * đi riêng (formatHostGenderLock) và luôn được ghép, phần cuối file khoá lại đúng ca này.
 *
 * Chạy: npx tsx scripts/check-host-gender-lock.ts
 */
import assert from 'node:assert';
import { formatStageBibleBlock, formatHostGenderLock } from '../lib/livestream/stageBible';
import { buildScriptUserPrompt } from '../lib/livestream/scriptPrompt';
import { LIVESTREAM_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';
import type { LivestreamStageBible } from '../lib/livestream/types';

/** Chuỗi thật sự vào user prompt: câu khoá giới tính + khối sân khấu, đúng thứ tự route ghép. */
function lockPlusBible(bible: LivestreamStageBible): string {
  return `${formatHostGenderLock(bible)}${formatStageBibleBlock(bible)}`;
}

const base: Omit<LivestreamStageBible, 'host' | 'voice'> = {
  scene: 'phòng khách sáng đèn',
  camera: 'trung cảnh ngang tầm mắt',
  wardrobeLock: 'không đổi trang phục',
  modelImagePath: 'inputs/model-1.jpg',
  inputsFingerprint: 'fp',
};

// --- bible NAM: phải cấm nữ ngay đầu khối ---
let block = lockPlusBible({
  ...base,
  host: 'Nam, khoảng 35-40 tuổi, đầu cạo gọn, đeo kính gọng trong suốt, áo phông đen',
  voice: 'Nam, giọng trầm vừa phải, vui tươi',
});
assert.ok(block.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NAM'), 'câu cấm phải là dòng ĐẦU TIÊN, không phải dòng cuối');
assert.ok(block.includes('KHÔNG viết người dẫn nữ'), 'phải cấm tường minh giới tính sai');
assert.ok(block.includes('tóc đuôi ngựa'), 'phải cấm đúng chi tiết LLM hay bịa ra (ca thật job 825314)');
assert.ok(block.includes('Dùng đại từ "anh"'), 'phải chỉ định đại từ để LLM không rơi về "cô"');
assert.ok(
  block.indexOf('⛔') < block.indexOf('SÂN KHẤU CỐ ĐỊNH'),
  'câu cấm phải đứng TRƯỚC phần mô tả sân khấu'
);

// --- bible NỮ: đối xứng, cấm nam ---
block = lockPlusBible({
  ...base,
  host: 'Nữ, khoảng 27 tuổi, tóc dài buộc đuôi ngựa, áo thun trắng',
  voice: 'Nữ, giọng cao vừa, vui tươi',
});
assert.ok(block.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NỮ'), 'bible nữ phải khoá chiều ngược lại');
assert.ok(block.includes('KHÔNG viết người dẫn nam'), 'bible nữ phải cấm viết nam');
assert.ok(block.includes('Dùng đại từ "cô"'), 'bible nữ phải chỉ định đại từ "cô"');

// --- BẪY "Việt Nam": chữ "Nam" trong địa danh KHÔNG phải giới tính nam ---
// Đây đúng là host mặc định khi job không có ảnh mẫu, nên sai ở đây là hỏng luôn tính năng.
block = lockPlusBible({
  ...base,
  host: 'Nữ, người Việt Nam, khoảng 25 tuổi, da trắng trẻo, gương mặt xinh xắn, tóc đen dài',
  voice: 'Nữ trẻ, giọng vui tươi',
});
assert.ok(
  block.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NỮ'),
  '"Việt Nam" không được làm bộ dò tưởng là giới tính nam rồi mất câu khoá'
);
// Nam thật + quốc tịch Việt Nam vẫn phải ra nam.
block = lockPlusBible({
  ...base,
  host: 'Nam, người Việt Nam, khoảng 35 tuổi, đầu cạo gọn, đeo kính',
  voice: 'Nam, giọng trầm',
});
assert.ok(block.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NAM'), 'nam + "Việt Nam" vẫn phải ra nam');

// --- không nhận ra giới tính → bỏ câu cấm, KHÔNG đoán bừa ---
block = lockPlusBible({
  ...base,
  host: 'Người dẫn trẻ trung, năng động, mặc áo thể thao',
  voice: 'giọng vui tươi',
});
assert.ok(!block.includes('⛔'), 'không rõ giới tính thì không được bịa ra câu cấm');
assert.ok(block.startsWith('SÂN KHẤU CỐ ĐỊNH'), 'không có câu cấm thì khối bắt đầu như cũ');

// --- lẫn cả hai từ khoá (VD "phù hợp cả nam và nữ") → không đoán ---
block = lockPlusBible({
  ...base,
  host: 'Người dẫn phù hợp cả nam và nữ, khoảng 30 tuổi',
  voice: 'giọng vui tươi',
});
assert.ok(!block.includes('⛔'), 'mô tả lẫn cả nam lẫn nữ thì không được chọn bừa một bên');

// --- system prompt phải tự nhường quyền cho bible ---
assert.ok(
  LIVESTREAM_SYSTEM_PROMPT.includes('SÂN KHẤU CỐ ĐỊNH CỦA BUỔI LIVE'),
  'BƯỚC 1 phải nhắc đúng TÊN khối bible để LLM nhận ra mà bỏ qua'
);
assert.ok(
  LIVESTREAM_SYSTEM_PROMPT.indexOf('BỎ QUA\nHOÀN TOÀN') > 0 ||
    LIVESTREAM_SYSTEM_PROMPT.includes('BỎ QUA'),
  'BƯỚC 1 phải nói rõ bỏ qua khi đã có bible'
);

// --- TẮT khối sc_bible vẫn PHẢI còn câu khoá giới tính (ca thật job combo-100-khay) ---
const bibleNam: LivestreamStageBible = {
  ...base,
  host: 'Nam, người Việt Nam, khoảng 35 tuổi, đầu cạo gọn, đeo kính',
  voice: 'Nam, giọng trầm',
};
const argsChung = {
  description: 'Combo 100 khay giấy bạc lót nồi chiên không dầu',
  durations: [8, 8],
  stageBibleBlock: formatStageBibleBlock(bibleNam),
  hostGenderLock: formatHostGenderLock(bibleNam),
};
const promptTatBible = buildScriptUserPrompt({ ...argsChung, disabledBlocks: ['sc_bible'] });
assert.ok(
  promptTatBible.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NAM'),
  'tắt sc_bible vẫn phải giữ câu khoá giới tính ở ĐẦU user prompt'
);
assert.ok(
  !promptTatBible.includes('SÂN KHẤU CỐ ĐỊNH'),
  'tắt sc_bible thì phần mô tả sân khấu phải biến mất (chỉ câu khoá ở lại)'
);

// Bật đủ khối: câu khoá vẫn đứng trước khối sân khấu, không bị nhân đôi.
const promptDuBlock = buildScriptUserPrompt(argsChung);
assert.ok(promptDuBlock.startsWith('⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ NAM'), 'câu khoá phải đứng đầu');
assert.ok(
  promptDuBlock.indexOf('⛔') < promptDuBlock.indexOf('SÂN KHẤU CỐ ĐỊNH'),
  'câu khoá phải đứng TRƯỚC khối sân khấu'
);
assert.equal(
  promptDuBlock.split('⛔ NGƯỜI DẪN').length - 1,
  1,
  'câu khoá chỉ được xuất hiện MỘT lần, không nhân đôi khi bật sc_bible'
);

console.log('✓ check-host-gender-lock: tất cả assert pass');
