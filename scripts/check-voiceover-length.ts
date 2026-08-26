/**
 * Self-check ràng buộc độ dài lời thoại livestream:
 * 1. Trần số từ ghi trong prompt (buildLivestreamUserPrompt) PHẢI khớp ngưỡng chấm vượt
 *    (findOverlongSegments) — lệch nhau thì LLM viết "đúng" prompt vẫn bị chấm là vượt.
 * 2. replaceSpokenLine thay đúng câu thoại NGAY TRONG veoPrompt (thứ Veo thực sự đọc) — bỏ sót
 *    thì rút gọn voiceoverVi xong video vẫn dài y như cũ.
 *
 * Chạy: npx tsx scripts/check-voiceover-length.ts
 */
import assert from 'node:assert';
import { buildLivestreamUserPrompt } from '../lib/livestream/scriptPrompt';
import { countWords, findOverlongSegments, maxWordsFor } from '../lib/livestream/segmentSanitize';
import { replaceSpokenLine } from '../lib/livestream/shortenVoiceover';
import type { LivestreamSegment } from '../lib/livestream/types';

const seg = (over: Partial<LivestreamSegment>): LivestreamSegment => ({
  id: 'seg-01',
  order: 0,
  voiceoverVi: '',
  veoPrompt: '',
  duration: 8,
  status: 'idle',
  jobId: null,
  videoPath: null,
  videoUrl: null,
  lastFramePath: null,
  error: null,
  attempts: 0,
  lastUpdatedAt: null,
  ...over,
});

// ---------------------------------------------------------------
// 1. Trần trong prompt == ngưỡng chấm vượt
// ---------------------------------------------------------------
for (const d of [4, 7, 8, 12]) {
  const prompt = buildLivestreamUserPrompt('mô tả', [d]);
  const m = prompt.match(/tối đa (\d+) từ/);
  assert.ok(m, `prompt ${d}s phải ghi giới hạn số từ`);
  assert.strictEqual(
    Number(m![1]),
    maxWordsFor(d),
    `trần ghi trong prompt (${m![1]}) phải khớp maxWordsFor(${d}) = ${maxWordsFor(d)}`
  );
}

// Mốc "lý tưởng" phải THẤP HƠN trần, nếu không nó vô nghĩa.
const p8 = buildLivestreamUserPrompt('mô tả', [8]);
const ideal = Number(p8.match(/lý tưởng (\d+) từ/)![1]);
assert.ok(ideal < maxWordsFor(8), 'mốc lý tưởng phải thấp hơn trần cứng');

// Câu đúng trần KHÔNG bị chấm vượt; thêm 1 từ là vượt (biên khớp chính xác).
const atLimit = Array.from({ length: maxWordsFor(8) }, () => 'từ').join(' ');
assert.strictEqual(findOverlongSegments([seg({ voiceoverVi: atLimit })]).length, 0, 'đúng trần: không vượt');
assert.strictEqual(
  findOverlongSegments([seg({ voiceoverVi: `${atLimit} dư` })]).length,
  1,
  'trần + 1 từ: phải bị chấm vượt'
);
assert.strictEqual(countWords('  a   b \n c '), 3, 'countWords bỏ khoảng trắng thừa');

// ---------------------------------------------------------------
// 2. replaceSpokenLine sửa đúng câu trong veoPrompt
// ---------------------------------------------------------------
const OLD = 'Chào cả nhà mình đã quay lại rồi nè! Hôm nay mở màn (siêu xinh) nha!';
const NEW = 'Chào cả nhà, mở màn set này nha!';
const veo = `A woman sits at a table. The person has a warm voice, speaks in Vietnamese, saying: "${OLD}". Audio: quiet room tone. no subtitles, no captions, no on-screen text.`;

const out = replaceSpokenLine(veo, OLD, NEW);
assert.ok(out.includes(`saying: "${NEW}"`), 'phải thay câu mới vào đúng cú pháp saying');
assert.ok(!out.includes(OLD), 'câu cũ phải biến mất khỏi veoPrompt');
assert.ok(out.includes('Audio: quiet room tone'), 'phần còn lại của veoPrompt giữ nguyên');
assert.ok(out.endsWith('no on-screen text.'), 'đuôi Technical giữ nguyên');

// Câu cũ xuất hiện ngoài cụm saying (VD lặp trong phần mô tả) — vẫn thay hết.
const veoDup = `Text ${OLD} more. saying: "${OLD}". end`;
const outDup = replaceSpokenLine(veoDup, OLD, NEW);
assert.ok(!outDup.includes(OLD), 'mọi lần xuất hiện của câu cũ đều được thay');

// Model paraphrase (câu trong veoPrompt khác voiceoverVi) → fallback thay nội dung trong saying.
const veoDrift = `He says, speaks in Vietnamese, saying: "Một câu hoàn toàn khác". Audio: room tone.`;
const outDrift = replaceSpokenLine(veoDrift, OLD, NEW);
assert.ok(outDrift.includes(`saying: "${NEW}"`), 'fallback: thay nội dung trong cặp ngoặc sau saying');
assert.ok(outDrift.includes('Audio: room tone'), 'fallback không được nuốt phần sau');

// Không có cụm saying và không tìm thấy câu cũ → trả nguyên bản, KHÔNG làm vỡ prompt.
const veoNone = 'A man sits at a table. Audio: room tone.';
assert.strictEqual(replaceSpokenLine(veoNone, OLD, NEW), veoNone, 'không khớp gì thì giữ nguyên');

console.log('✓ check-voiceover-length: tất cả assert pass');
