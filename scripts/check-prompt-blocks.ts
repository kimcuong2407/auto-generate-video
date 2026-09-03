/**
 * Self-check: tắt/bật từng khối server tự ghép vào prompt (lib/livestream/promptBlocks.ts).
 *
 * Vì sao cần 5 nhóm dưới đây — mỗi nhóm khoá một lỗi mà typecheck KHÔNG bắt được, và bấm thử một
 * lần cũng không lộ ra:
 *
 * 1. Mặc định phải BẬT HẾT. Sai chiều (lưu "khối được bật" thay vì "khối bị tắt") thì mọi job cũ
 *    có mảng rỗng thành tắt sạch — prompt mất khối sân khấu, 32 đoạn ra người dẫn khác nhau, tốn
 *    tiền gen lại video mà UI không báo gì.
 * 2. Tắt 1 khối không được làm mất khối khác (tắt lan).
 * 3. RÀNG BUỘC KỸ THUẬT luôn còn dù tắt hết — quan trọng nhất. Tắt được chúng là vỡ luồng gen:
 *    sanitizeSegments ném lỗi "AI chỉ trả về X/N đoạn" và cả lượt gen chết.
 * 4. Key lạ (dữ liệu cũ, key đã đổi tên) không được làm vỡ hàm build.
 * 5. Khối có trong registry mà chưa nối vào hàm build = UI hiện ô tick bấm không có tác dụng.
 *
 * Không đụng DB: chỉ hàm thuần + quét mã nguồn.
 *
 * Chạy: npm run check:prompt-blocks
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PROMPT_BLOCKS,
  blocksForStep,
  isBlockEnabled,
  isPromptBlockKey,
  type PromptBlockKey,
} from '../lib/livestream/promptBlocks';
import { buildBackgroundPrompt } from '../lib/livestream/backgroundGenerate';
import { buildLivestreamUserPrompt, buildScriptUserPrompt } from '../lib/livestream/scriptPrompt';
import type { LivestreamStageBible, LivestreamV2Input } from '../lib/livestream/types';

const bible: LivestreamStageBible = {
  host: 'HOST_NAM_35',
  scene: 'SCENE_PHONG_LIVE',
  camera: 'CAMERA_CAN_CANH',
  voice: 'VOICE_NAM_AM',
  wardrobeLock: '',
};
const entries = [
  { rel: 'inputs/model-1.jpg', label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' },
  { rel: 'inputs/p1.jpg', label: 'ảnh SẢN PHẨM THẬT 1' },
];
const v2Input: LivestreamV2Input = {
  advantages: ['UU_DIEM_A', 'UU_DIEM_B'],
  platform: 'Shopee Live',
  channelName: 'TEN_KENH_X',
  followerCount: '117k',
  viewerCount: '1k',
  promotion: 'KHUYEN_MAI_Y',
  cta: 'CTA_Z',
  dialoguesPerScene: 3,
};
const DURATIONS = [8, 8, 6];

// ------------------------------------------------------------------
// 1. Mặc định = BẬT HẾT (null / undefined / rỗng đều như nhau)
// ------------------------------------------------------------------
for (const d of [undefined, null, []] as const) {
  for (const b of PROMPT_BLOCKS) {
    assert.equal(
      isBlockEnabled(d, b.key),
      true,
      `mặc định (${JSON.stringify(d)}) phải BẬT khối "${b.key}" — sai chiều là job cũ mất khối im lặng`
    );
  }
}

const bgAll = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, []);
assert.ok(bgAll.includes('MO_TA_SP'), 'mặc định phải có mô tả sản phẩm');
assert.ok(bgAll.includes(bible.host), 'mặc định phải có sân khấu');
assert.ok(bgAll.includes('1. ảnh NGƯỜI MẪU/NGƯỜI DẪN'), 'mặc định phải có chú giải ảnh');
// Bản không truyền tham số phải GIỐNG HỆT bản truyền mảng rỗng — không được lệch hành vi.
assert.equal(
  buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries),
  bgAll,
  'bỏ trống disabledBlocks phải cho kết quả y hệt mảng rỗng'
);

// ------------------------------------------------------------------
// 2. Tắt từng khối: mất ĐÚNG khối đó, khối khác còn nguyên
// ------------------------------------------------------------------
let p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, ['bg_product']);
assert.ok(!p.includes('MO_TA_SP'), 'tắt bg_product phải bỏ mô tả sản phẩm');
assert.ok(p.includes(bible.host) && p.includes('1. ảnh NGƯỜI MẪU'), 'tắt bg_product không được làm mất khối khác');
assert.ok(p.startsWith('PROMPT_GOC'), 'prompt người dùng viết luôn đứng đầu');

p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, ['bg_bible']);
assert.ok(!p.includes(bible.host), 'tắt bg_bible phải bỏ khối sân khấu');
assert.ok(p.includes('MO_TA_SP') && p.includes('1. ảnh NGƯỜI MẪU'), 'tắt bg_bible không được làm mất khối khác');

p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, ['bg_ref_legend']);
assert.ok(!p.includes('ẢNH REFERENCE ĐÍNH KÈM'), 'tắt bg_ref_legend phải bỏ khối chú giải ảnh');
assert.ok(p.includes('MO_TA_SP') && p.includes(bible.host), 'tắt bg_ref_legend không được làm mất khối khác');

// Tắt HẾT: prompt gửi AI ≈ đúng chuỗi người dùng viết. Đây chính là điều Mr.D cần.
p = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, [
  'bg_product',
  'bg_bible',
  'bg_ref_legend',
]);
assert.equal(p, 'PROMPT_GOC', 'tắt hết 3 khối thì prompt phải đúng bằng chuỗi người dùng viết');
assert.ok(!p.includes('undefined') && !p.includes('null'), 'tắt khối không được rò chuỗi rác');

// --- script V1 ---
const position = { index: 1, total: 3, prevProductName: 'SAN_PHAM_TRUOC' };
const v1All = buildLivestreamUserPrompt('MO_TA_SP', DURATIONS, 'MO_TA_NGOAI_HINH', 'BIBLE_BLOCK', position, []);
assert.ok(v1All.includes('BIBLE_BLOCK'), 'V1 mặc định phải có sân khấu');
assert.ok(v1All.includes('MO_TA_NGOAI_HINH'), 'V1 mặc định phải có mô tả ngoại hình');
assert.ok(v1All.includes('SAN_PHAM_TRUOC'), 'V1 mặc định phải có vị trí sản phẩm');

let v1 = buildLivestreamUserPrompt('MO_TA_SP', DURATIONS, 'MO_TA_NGOAI_HINH', 'BIBLE_BLOCK', position, ['sc_bible']);
assert.ok(!v1.includes('BIBLE_BLOCK'), 'tắt sc_bible phải bỏ khối sân khấu ở V1');
assert.ok(v1.includes('MO_TA_NGOAI_HINH') && v1.includes('SAN_PHAM_TRUOC'), 'tắt sc_bible không làm mất khối khác');

v1 = buildLivestreamUserPrompt('MO_TA_SP', DURATIONS, 'MO_TA_NGOAI_HINH', 'BIBLE_BLOCK', position, ['sc_position']);
assert.ok(!v1.includes('SAN_PHAM_TRUOC'), 'tắt sc_position phải bỏ khối vị trí');
assert.ok(!v1.includes('TUYỆT ĐỐI KHÔNG chào lại'), 'tắt sc_position phải bỏ cả câu cấm chào lại');

v1 = buildLivestreamUserPrompt('MO_TA_SP', DURATIONS, 'MO_TA_NGOAI_HINH', 'BIBLE_BLOCK', position, ['sc_visual']);
assert.ok(!v1.includes('MO_TA_NGOAI_HINH'), 'tắt sc_visual phải bỏ khối mô tả ngoại hình');

// --- script V2 ---
const v2Args = {
  description: 'MO_TA_SP',
  durations: DURATIONS,
  v2Input,
  visualDescription: 'MO_TA_NGOAI_HINH',
  stageBibleBlock: 'BIBLE_BLOCK',
  position,
  productLockBlock: 'LOCK_BLOCK',
};
const v2All = buildScriptUserPrompt({ ...v2Args, disabledBlocks: [] });
assert.ok(v2All.includes('LOCK_BLOCK'), 'V2 mặc định phải có khoá ngoại hình');
assert.ok(v2All.includes('UU_DIEM_A'), 'V2 mặc định phải có ưu điểm');
assert.ok(v2All.includes('TEN_KENH_X'), 'V2 mặc định phải có thông tin buổi live');

let v2 = buildScriptUserPrompt({ ...v2Args, disabledBlocks: ['sc_lock'] });
assert.ok(!v2.includes('LOCK_BLOCK'), 'tắt sc_lock phải bỏ khối khoá ngoại hình');
// Lock vốn THAY THẾ visual; tắt lock thì visual được hiện lại (lý do thay thế đã hết).
assert.ok(v2.includes('MO_TA_NGOAI_HINH'), 'tắt sc_lock thì mô tả ngoại hình phải hiện lại');

v2 = buildScriptUserPrompt({ ...v2Args, disabledBlocks: ['sc_lock', 'sc_visual'] });
assert.ok(
  !v2.includes('LOCK_BLOCK') && !v2.includes('MO_TA_NGOAI_HINH'),
  'tắt cả sc_lock và sc_visual thì không còn mô tả ngoại hình nào'
);

v2 = buildScriptUserPrompt({ ...v2Args, disabledBlocks: ['sc_advantages'] });
assert.ok(!v2.includes('ƯU ĐIỂM SẢN PHẨM'), 'tắt sc_advantages phải bỏ khối ưu điểm');
assert.ok(v2.includes('TEN_KENH_X'), 'tắt sc_advantages không làm mất thông tin buổi live');

v2 = buildScriptUserPrompt({ ...v2Args, disabledBlocks: ['sc_v2_input'] });
assert.ok(!v2.includes('TEN_KENH_X'), 'tắt sc_v2_input phải bỏ khối thông tin buổi live');
assert.ok(!v2.includes('THÔNG TIN BUỔI LIVE'), 'tắt sc_v2_input phải bỏ cả tiêu đề khối');
assert.ok(v2.includes('Mô tả sản phẩm:'), 'tắt sc_v2_input vẫn phải giữ nhãn mô tả sản phẩm');

// ------------------------------------------------------------------
// 3. RÀNG BUỘC KỸ THUẬT luôn còn dù TẮT HẾT — nhóm quan trọng nhất
// ------------------------------------------------------------------
const ALL_KEYS = PROMPT_BLOCKS.map((b) => b.key);

const v1Off = buildLivestreamUserPrompt('MO_TA_SP', DURATIONS, 'MO_TA_NGOAI_HINH', 'BIBLE_BLOCK', position, ALL_KEYS);
assert.ok(v1Off.includes(`Viết đúng ${DURATIONS.length} đoạn`), 'V1: số đoạn là ràng buộc BẮT BUỘC, không được tắt');
assert.ok(
  v1Off.includes(`Trả về đúng ${DURATIONS.length} phần tử trong "segments"`),
  'V1: hợp đồng "segments" là ràng buộc BẮT BUỘC — mất là sanitizeSegments ném lỗi, vỡ cả lượt gen'
);
assert.ok(v1Off.includes('GIỚI HẠN SỐ TỪ BẮT BUỘC'), 'V1: giới hạn số từ không nằm trong danh sách cho tắt');
assert.ok(v1Off.includes('Đoạn 3 (6s)'), 'V1: ràng buộc số từ phải liệt kê đủ từng đoạn');
assert.ok(v1Off.includes('MO_TA_SP'), 'V1: mô tả sản phẩm không được tắt — AI cần biết viết về cái gì');

const v2Off = buildScriptUserPrompt({ ...v2Args, disabledBlocks: ALL_KEYS });
assert.ok(
  v2Off.includes(`Trả về đúng ${DURATIONS.length} phần tử trong "segments"`),
  'V2: hợp đồng "segments" là ràng buộc BẮT BUỘC'
);
assert.ok(v2Off.includes(`KỊCH BẢN GỒM ĐÚNG ${DURATIONS.length} CẢNH`), 'V2: số cảnh là ràng buộc BẮT BUỘC');
assert.ok(v2Off.includes('MO_TA_SP'), 'V2: mô tả sản phẩm không được tắt');
// Bảng cảnh là nơi DUY NHẤT mang thời lượng ở V2 — mất là sai số cảnh, vỡ luồng.
for (const [i, d] of DURATIONS.entries()) {
  assert.ok(
    v2Off.includes(`Cảnh ${i + 1} —`) && v2Off.includes(`| ${d}s |`),
    `V2: bảng cảnh phải còn đủ dòng cảnh ${i + 1} kèm thời lượng ${d}s dù tắt hết mọi khối`
  );
}

// Assert NGƯỢC: không key nào trong registry trỏ tới ràng buộc kỹ thuật.
const FORBIDDEN = ['segments', 'so_doan', 'scene_plan', 'word', 'so_tu', 'duration', 'description'];
for (const b of PROMPT_BLOCKS) {
  for (const bad of FORBIDDEN) {
    assert.ok(
      !b.key.includes(bad),
      `key "${b.key}" nghe như ràng buộc kỹ thuật ("${bad}") — những khối đó KHÔNG được cho tắt`
    );
  }
}

// ------------------------------------------------------------------
// 4. Key lạ bị bỏ qua, không làm vỡ hàm build
// ------------------------------------------------------------------
assert.equal(isBlockEnabled(['khoi_khong_ton_tai'], 'sc_bible'), true, 'key lạ không được tắt oan khối khác');
assert.equal(isPromptBlockKey('khoi_khong_ton_tai'), false, 'key lạ phải bị nhận là không hợp lệ');
assert.equal(isPromptBlockKey('sc_bible'), true, 'key thật phải hợp lệ');
const withGarbage = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, [
  'rac',
  '',
  'bg_bible',
]);
assert.ok(!withGarbage.includes(bible.host), 'key thật trong danh sách lẫn rác vẫn phải có tác dụng');
assert.ok(withGarbage.includes('MO_TA_SP'), 'rác trong danh sách không được tắt lan sang khối khác');

// ------------------------------------------------------------------
// 5. Mọi key trong registry phải được NỐI vào hàm build
// ------------------------------------------------------------------
const srcFiles = [
  'lib/livestream/backgroundGenerate.ts',
  'lib/livestream/scriptPrompt.ts',
  'lib/livestream/scriptPromptV2.ts',
];
const buildSrc = srcFiles.map((f) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')).join('\n');
for (const b of PROMPT_BLOCKS) {
  assert.ok(
    buildSrc.includes(`'${b.key}'`),
    `khối "${b.key}" có trong registry nhưng chưa nối vào hàm build — UI hiện ô tick mà bấm không có tác dụng`
  );
}

// Phân nhóm theo bước phải khớp registry, để UI không vẽ thiếu/thừa ô tick.
assert.equal(blocksForStep('background').length, 3, 'bước background phải có đúng 3 khối');
assert.equal(blocksForStep('script').length, 6, 'bước script phải có đúng 6 khối');
assert.equal(
  new Set(ALL_KEYS).size,
  ALL_KEYS.length,
  'key trùng nhau trong registry — tắt 1 khối sẽ tắt lan sang khối kia'
);

console.log(
  `✅ check-prompt-blocks: OK (${PROMPT_BLOCKS.length} khối tắt được, ràng buộc kỹ thuật luôn giữ, mặc định bật hết)`
);
