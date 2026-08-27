/**
 * Self-check: prompt PREVIEW phải là ĐÚNG chuỗi mà bước gen thật gửi cho AI.
 *
 * Vì sao cần: prompt gen background được ghép từ 4 mảnh (prompt gốc + mô tả sản phẩm + sân khấu
 * đã chốt + chú giải ảnh ref). Trước đây phần ghép nằm inline trong triggerBackgroundImageGeneration
 * nên UI không có cách nào hiện đúng — nay tách ra buildBackgroundPrompt để route preview và route
 * gen dùng CHUNG. Check này khoá lại hợp đồng đó: mọi mảnh phải có mặt, đúng thứ tự.
 *
 * Chạy: npx tsx scripts/check-preview-prompt.ts
 */
import assert from 'node:assert';
import { buildBackgroundPrompt } from '../lib/livestream/backgroundGenerate';
import { formatStageBibleBlock } from '../lib/livestream/stageBible';
import { buildLivestreamUserPrompt } from '../lib/livestream/scriptPrompt';
import type { LivestreamStageBible } from '../lib/livestream/types';

const bible: LivestreamStageBible = {
  host: 'nam 30 tuổi đầu cua đeo kính',
  scene: 'góc phòng khách sáng đèn',
  camera: 'trung cảnh ngang tầm mắt',
  voice: 'giọng nam vui tươi',
  wardrobeLock: 'không đổi trang phục',
  modelImagePath: 'inputs/model-1.jpg',
  inputsFingerprint: 'fp-1',
};
const entries = [
  { rel: 'inputs/model-1.jpg', label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' },
  { rel: 'inputs/p1.jpg', label: 'ảnh SẢN PHẨM THẬT 1' },
];

// --- background: đủ 4 mảnh, đúng thứ tự ---
let p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries);
assert.ok(p.startsWith('PROMPT_GOC\n'), 'prompt gốc phải đứng đầu');
assert.ok(p.includes('MO_TA_SP'), 'mô tả sản phẩm phải được ghép vào');
assert.ok(p.includes(bible.host), 'mô tả người dẫn từ bible phải có mặt');
assert.ok(p.includes(bible.scene), 'bối cảnh từ bible phải có mặt');
assert.ok(p.includes(bible.camera), 'góc máy từ bible phải có mặt');
assert.ok(p.includes('1. ảnh NGƯỜI MẪU/NGƯỜI DẪN'), 'chú giải ảnh phải đánh số theo thứ tự gửi');
assert.ok(p.includes('2. ảnh SẢN PHẨM THẬT 1'), 'ảnh thứ 2 phải đúng nhãn + số');
assert.ok(
  p.indexOf('MO_TA_SP') < p.indexOf(bible.host) && p.indexOf(bible.host) < p.indexOf('1. ảnh NGƯỜI MẪU'),
  'thứ tự bắt buộc: gốc → mô tả SP → bible → chú giải ảnh'
);

// --- background: chưa chốt bible → bỏ hẳn khối bible, KHÔNG chèn "null"/"undefined" ---
p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', null, entries);
assert.ok(!p.includes('undefined') && !p.includes('null'), 'bible null không được rò chuỗi rác vào prompt');
assert.ok(!p.includes('sân khấu livestream cố định'), 'chưa chốt bible thì không có khối sân khấu');
assert.ok(p.includes('1. ảnh NGƯỜI MẪU/NGƯỜI DẪN'), 'không có bible vẫn phải giữ chú giải ảnh');

// --- background: không có ảnh nào → bỏ hẳn khối chú giải ---
p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, []);
assert.ok(!p.includes('ẢNH REFERENCE ĐÍNH KÈM'), 'không có ảnh thì không chèn khối chú giải rỗng');

// --- script: user prompt phải chứa bible + mô tả ngoại hình + ràng buộc số từ ---
const userPrompt = buildLivestreamUserPrompt(
  'MO_TA_SP',
  [8, 8, 6],
  'MO_TA_NGOAI_HINH',
  formatStageBibleBlock(bible),
  { index: 1, total: 3, prevProductName: 'Sản phẩm trước' }
);
assert.ok(userPrompt.includes(bible.host), 'user prompt phải nhúng người dẫn đã chốt');
assert.ok(userPrompt.includes('MO_TA_NGOAI_HINH'), 'mô tả ngoại hình sản phẩm phải được ghép vào');
assert.ok(userPrompt.includes('Sản phẩm trước'), 'sản phẩm giữa live phải nêu sản phẩm vừa giới thiệu');
assert.ok(userPrompt.includes('Đoạn 3 (6s)'), 'ràng buộc số từ phải liệt kê đủ từng đoạn');
assert.ok(
  userPrompt.indexOf(bible.host) < userPrompt.indexOf('MO_TA_SP'),
  'khối sân khấu phải đứng TRƯỚC mô tả sản phẩm (đúng thứ tự AI đọc)'
);

// --- script: sản phẩm đầu tiên được chào khán giả, sản phẩm sau thì không ---
const first = buildLivestreamUserPrompt('SP', [8], undefined, undefined, { index: 0, total: 2 });
assert.ok(first.includes('MỞ ĐẦU'), 'sản phẩm đầu phải được đánh dấu mở màn');
assert.ok(!first.includes('TUYỆT ĐỐI KHÔNG chào lại'), 'sản phẩm đầu không bị cấm chào');

console.log('✓ check-preview-prompt: tất cả assert pass');
