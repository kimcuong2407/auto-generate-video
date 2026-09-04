/**
 * Self-check: span của từng khối tự ghép phải trỏ ĐÚNG đoạn văn của khối đó trong prompt cuối.
 *
 * Vì sao cần: modal cắt prompt theo offset server trả về, không tự dò text. Offset lệch 1 ký tự là
 * nhãn "🧩 Sân khấu cố định" đóng lên đoạn của khối khác — sai còn tệ hơn không chia khối, vì Mr.D
 * sẽ tắt nhầm khối. Check này khoá: các span không chồng lấn, ghép lại ra ĐÚNG prompt gốc, và mỗi
 * đoạn cắt ra phải biến mất khi tắt đúng khối đó.
 *
 * Ca đã bắt được (đừng quay lại cách cũ): bản đầu tiên dò span bằng cách dựng prompt 2 lần rồi
 * diff prefix/suffix — sai ở 2 chỗ, (1) sc_lock/sc_advantages liền nhau cùng mở đầu "\n\n" nên
 * ranh giới trượt, (2) ở V2 tắt sc_lock làm sc_visual hiện lại nên diff ra một đoạn lai không tồn
 * tại. Nay builder tự ghi chuỗi từng khối qua blockSink.
 *
 * Chạy: npx tsx scripts/check-prompt-block-spans.ts
 */
import assert from 'node:assert';
import { spansFromSink, type PromptBlockSink, type PromptBlockSpan } from '../lib/livestream/promptBlockSpans';
import { buildScriptUserPrompt } from '../lib/livestream/scriptPrompt';
import { formatStageBibleBlock } from '../lib/livestream/stageBible';
import { buildBackgroundPrompt } from '../lib/livestream/backgroundGenerate';
import type { LivestreamStageBible, LivestreamV2Input } from '../lib/livestream/types';

const bible: LivestreamStageBible = {
  host: 'nam 30 tuổi đầu cua đeo kính',
  scene: 'góc phòng khách sáng đèn',
  camera: 'trung cảnh ngang tầm mắt',
  voice: 'giọng nam vui tươi',
  wardrobeLock: 'không đổi trang phục',
  modelImagePath: 'inputs/model-1.jpg',
  inputsFingerprint: 'fp-1',
};

const v2Input: LivestreamV2Input = {
  platform: 'Shopee Live',
  channelName: 'Kênh Test',
  followerCount: '12k',
  viewerCount: '300',
  promotion: 'giảm 20%',
  cta: 'bấm giỏ hàng',
  advantages: ['chống nước', 'pin 20 giờ'],
  dialoguesPerScene: 3,
};

/** Cắt prompt theo span rồi ghép lại — phải ra đúng chuỗi gốc, không mất/thừa ký tự nào. */
function assertSpansCoverExactly(prompt: string, spans: PromptBlockSpan[], what: string) {
  let cursor = 0;
  let rebuilt = '';
  for (const sp of spans) {
    assert.ok(sp.start >= cursor, `${what}: span chồng lấn hoặc sai thứ tự (start=${sp.start} < cursor=${cursor})`);
    assert.ok(sp.end <= prompt.length, `${what}: span vượt quá độ dài prompt`);
    assert.ok(sp.end > sp.start, `${what}: span rỗng`);
    rebuilt += prompt.slice(cursor, sp.start) + prompt.slice(sp.start, sp.end);
    cursor = sp.end;
  }
  rebuilt += prompt.slice(cursor);
  assert.strictEqual(rebuilt, prompt, `${what}: cắt theo span rồi ghép lại phải ra đúng prompt gốc`);
}

// ---------- script V2: đủ mọi khối ----------
const buildV2 = (disabledBlocks: readonly string[] | undefined, blockSink?: PromptBlockSink) =>
  buildScriptUserPrompt({
    description: 'MO_TA_SP',
    durations: [8, 8, 8, 8, 8, 8],
    v2Input,
    visualDescription: 'MO_TA_NGOAI_HINH',
    stageBibleBlock: formatStageBibleBlock(bible),
    position: { index: 1, total: 3, prevProductName: 'Sản phẩm trước' },
    productLockBlock: 'KHOÁ NGOẠI HÌNH: màu xanh navy, quai da bò',
    disabledBlocks,
    blockSink,
  });

const v2Sink: PromptBlockSink = {};
const v2Prompt = buildV2([], v2Sink);
const v2Spans = spansFromSink(v2Prompt, v2Sink);

assertSpansCoverExactly(v2Prompt, v2Spans, 'script V2');

const v2Keys = v2Spans.map((s) => s.key);
// sc_visual bị sc_lock thay thế khi lock bật (xem scriptPromptV2) → không có mặt, đúng thiết kế.
for (const key of ['sc_bible', 'sc_position', 'sc_lock', 'sc_advantages', 'sc_v2_input'] as const) {
  assert.ok(v2Keys.includes(key), `script V2 phải nhận diện được khối ${key}`);
}
assert.ok(!v2Keys.includes('sc_visual'), 'lock đang bật thì sc_visual không có mặt trong prompt');

// Nội dung mỗi span phải đúng là đoạn BIẾN MẤT khi tắt riêng khối đó.
//
// sc_lock là ngoại lệ CÓ CHỦ ĐÍCH: tắt lock thì sc_visual hiện lại (xem scriptPromptV2), nên prompt
// không co lại đúng bằng span — chỉ kiểm tra phần chữ của lock biến mất.
for (const sp of v2Spans) {
  const text = v2Prompt.slice(sp.start, sp.end);
  const without = buildV2([sp.key]);
  assert.ok(
    !without.includes(text.trim()),
    `span của ${sp.key} phải là đoạn biến mất khi tắt chính khối đó`
  );
  if (sp.key !== 'sc_lock') {
    assert.strictEqual(
      without.length,
      v2Prompt.length - text.length,
      `tắt ${sp.key} phải rút prompt đúng bằng độ dài span`
    );
  }
}

// Khối chứa đúng dữ liệu của nó — bắt ca span trỏ nhầm sang đoạn hàng xóm.
const textOf = (key: string) => {
  const sp = v2Spans.find((s) => s.key === key)!;
  return v2Prompt.slice(sp.start, sp.end);
};
assert.ok(textOf('sc_bible').includes(bible.host), 'span sc_bible phải chứa mô tả người dẫn');
assert.ok(textOf('sc_v2_input').includes('Kênh Test'), 'span sc_v2_input phải chứa tên kênh');
assert.ok(textOf('sc_advantages').includes('chống nước'), 'span sc_advantages phải chứa ưu điểm');
assert.ok(textOf('sc_lock').includes('xanh navy'), 'span sc_lock phải chứa mô tả đã khoá');
assert.ok(textOf('sc_position').includes('thứ 2/3'), 'span sc_position phải chứa vị trí sản phẩm');

// ---------- script V1: sc_visual hiện lại, không có khối V2-only ----------
const buildV1 = (disabledBlocks: readonly string[] | undefined, blockSink?: PromptBlockSink) =>
  buildScriptUserPrompt({
    description: 'MO_TA_SP',
    durations: [8, 8, 6],
    visualDescription: 'MO_TA_NGOAI_HINH',
    stageBibleBlock: formatStageBibleBlock(bible),
    position: { index: 0, total: 2 },
    disabledBlocks,
    blockSink,
  });
const v1Sink: PromptBlockSink = {};
const v1Prompt = buildV1([], v1Sink);
const v1Spans = spansFromSink(v1Prompt, v1Sink);
assertSpansCoverExactly(v1Prompt, v1Spans, 'script V1');
const v1Keys = v1Spans.map((s) => s.key);
assert.ok(v1Keys.includes('sc_visual'), 'V1 không có lock nên sc_visual phải có mặt');
assert.ok(!v1Keys.includes('sc_lock') && !v1Keys.includes('sc_advantages'), 'V1 không có khối V2-only');

// ---------- khối đang TẮT sẵn thì không trả span ----------
const offSink: PromptBlockSink = {};
const offPrompt = buildV2(['sc_bible'], offSink);
const offSpans = spansFromSink(offPrompt, offSink);
assert.ok(!offSpans.some((s) => s.key === 'sc_bible'), 'khối đang tắt không được trả span');
assertSpansCoverExactly(offPrompt, offSpans, 'script V2 (đã tắt 1 khối)');

// ---------- thiếu dữ liệu (chưa chốt sân khấu) → không span rỗng ----------
const noBibleSink: PromptBlockSink = {};
const noBiblePrompt = buildScriptUserPrompt({
  description: 'MO_TA_SP',
  durations: [8, 8],
  blockSink: noBibleSink,
});
const noBibleSpans = spansFromSink(noBiblePrompt, noBibleSink);
assert.ok(
  !noBibleSpans.some((s) => s.key === 'sc_bible' || s.key === 'sc_visual'),
  'khối không có dữ liệu thì không được trả span rỗng'
);

// ---------- background ----------
const entries = [
  { rel: 'inputs/model-1.jpg', label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' },
  { rel: 'inputs/p1.jpg', label: 'ảnh SẢN PHẨM THẬT 1' },
];
const bgSink: PromptBlockSink = {};
const bgPrompt = buildBackgroundPrompt('PROMPT_GOC', 'MO_TA_SP', bible, entries, undefined, [], bgSink);
const bgSpans = spansFromSink(bgPrompt, bgSink);
assertSpansCoverExactly(bgPrompt, bgSpans, 'background');
const bgKeys = bgSpans.map((s) => s.key);
for (const key of ['bg_product', 'bg_bible', 'bg_ref_legend'] as const) {
  assert.ok(bgKeys.includes(key), `background phải nhận diện được khối ${key}`);
}
assert.ok(
  bgPrompt.slice(bgSpans.find((s) => s.key === 'bg_ref_legend')!.start).includes('1. ảnh NGƯỜI MẪU'),
  'span bg_ref_legend phải chứa chú giải ảnh'
);

console.log(`✅ check-prompt-block-spans: OK (V2 ${v2Spans.length} khối, V1 ${v1Spans.length}, background ${bgSpans.length})`);
