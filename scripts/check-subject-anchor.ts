/**
 * Self-check: các thành phần veoPrompt KHÔNG được trỏ tới "Bước 1" mà không nêu nhánh SÂN KHẤU.
 *
 * Đây là root cause khiến 3 lần vá trước đều thất bại (job production 825314):
 * mục "(1) Subject" — dòng LLM đọc NGAY LÚC viết từng đoạn — ra lệnh "mô tả người dẫn ĐÚNG theo
 * mô tả cố định đã chốt ở Bước 1.b". Nhưng ta lại vừa vô hiệu hoá Bước 1 ("có khối SÂN KHẤU thì
 * BỎ QUA HOÀN TOÀN BƯỚC 1"), nên (1) Subject trỏ tới một mục ĐÃ BỊ HUỶ → LLM mất neo và quay về
 * mặc định quen thuộc (nữ 27 tuổi tóc đuôi ngựa).
 *
 * Nghịch lý: càng nhấn mạnh "bỏ qua Bước 1" thì càng cắt đứt cái neo mà (1) Subject bám vào.
 * Mọi tham chiếu Bước 1 phải kèm nhánh "lấy từ khối SÂN KHẤU nếu có".
 *
 * Chạy: npx tsx scripts/check-subject-anchor.ts
 */
import assert from 'node:assert';
import { LIVESTREAM_SYSTEM_PROMPT as P } from '../lib/livestream/promptDefaults';

// --- Không được còn tham chiếu Bước 1 "trần" (không nêu nhánh SÂN KHẤU) ---
const lines = P.split('\n');
const treo: string[] = [];
for (let i = 0; i < lines.length; i++) {
  if (!/Bước 1\.[abcd]/.test(lines[i])) continue;
  // Nhánh SÂN KHẤU có thể nằm ở dòng trước/sau vì prompt xuống dòng giữa câu.
  const ctx = lines.slice(Math.max(0, i - 4), i + 3).join(' ');
  if (!/SÂN KHẤU|không có thì|KHÔNG có khối/.test(ctx)) treo.push(lines[i].trim());
}
assert.deepStrictEqual(
  treo,
  [],
  `còn tham chiếu "Bước 1" treo lơ lửng (Bước 1 đã bị vô hiệu khi có bible) — LLM mất neo, quay về mặc định:\n${treo.join('\n')}`
);

// --- (1) Subject phải ra lệnh COPY NGUYÊN VĂN từ khối SÂN KHẤU ---
const flat = P.replace(/\s+/g, ' ');
const subjIdx = flat.indexOf('(1) Subject');
assert.ok(subjIdx > 0, 'phải có mục (1) Subject');
const subjBlock = flat.slice(subjIdx, flat.indexOf('(2) Action', subjIdx));
assert.ok(
  subjBlock.includes('SÂN KHẤU CỐ ĐỊNH CỦA BUỔI LIVE'),
  '(1) Subject phải nêu đích danh khối SÂN KHẤU làm nguồn — đây là dòng LLM đọc lúc viết từng đoạn'
);
assert.ok(
  subjBlock.includes('COPY NGUYÊN VĂN'),
  '(1) Subject phải bảo COPY NGUYÊN VĂN, không phải "tham khảo" — paraphrase là chỗ giới tính bị đổi'
);
assert.ok(
  subjBlock.includes('Bước 1 đã bị vô hiệu'),
  '(1) Subject phải nói rõ Bước 1 đã bị vô hiệu, tránh LLM quay lại lấy từ đó'
);

// --- Scene và Voice cũng phải có nhánh SÂN KHẤU ---
for (const [tag, next] of [['(3) Scene', '(4) Style'], ['(5) Dialogue', '(6) Sounds']] as const) {
  const i = flat.indexOf(tag);
  assert.ok(i > 0, `phải có mục ${tag}`);
  const block = flat.slice(i, flat.indexOf(next, i));
  assert.ok(
    block.includes('SÂN KHẤU'),
    `${tag} phải lấy từ khối SÂN KHẤU khi có, không chỉ trỏ về Bước 1`
  );
}

console.log('✓ check-subject-anchor: tất cả assert pass');
