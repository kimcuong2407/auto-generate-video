/**
 * Self-check: panel prompt của tab Video Review phải khớp đúng các bước AI mà luồng đó THẬT SỰ chạy.
 *
 * Vì sao cần: ReviewPromptPanel lọc bước bằng một danh sách CỨNG (REVIEW_STEPS). Danh sách đó lệch
 * khỏi thực tế là lỗi im lặng theo cả hai chiều, không có exception nào ném ra:
 *   - Thừa/sai key  → bước biến mất khỏi panel (filter không khớp), Mr.D tưởng không sửa được.
 *   - Thiếu key     → một lượt gọi AI của luồng review không có chỗ sửa prompt, phải vào
 *                     /settings/prompts mò giữa 16 bước lẫn với luồng livestream.
 *
 * Nguồn sự thật cho "luồng review gọi AI ở đâu": chính mã nguồn — mọi `prompts.get('...')` trong
 * lib/data + app/api/projects. Đối chiếu với danh sách trong panel.
 *
 * Chạy: npm run check:review-prompt-panel
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROMPT_STEPS, isPromptStepKey } from '../lib/livestream/promptSteps';

const ROOT = process.cwd();

function readAll(dir: string): string {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out += readAll(p);
    else if (entry.name.endsWith('.ts')) out += fs.readFileSync(p, 'utf8');
  }
  return out;
}

// --- Bước AI mà luồng review thật sự chạy (quét mã nguồn) ---
const reviewSrc = [path.join(ROOT, 'lib/data'), path.join(ROOT, 'app/api/projects')]
  .map(readAll)
  .join('\n');
const usedInCode = new Set<string>();
for (const m of reviewSrc.matchAll(/prompts\.get\('([a-z0-9_]+)'/g)) {
  usedInCode.add(m[1]);
}
assert.ok(usedInCode.size > 0, 'không quét thấy prompts.get() nào trong luồng review — regex hỏng?');

// --- Bước panel đang hiện ---
const panelSrc = fs.readFileSync(path.join(ROOT, 'components/steps/ReviewPromptPanel.tsx'), 'utf8');
const block = panelSrc.match(/const REVIEW_STEPS = \[(.*?)\] as const;/s);
assert.ok(block, 'không tìm thấy REVIEW_STEPS trong ReviewPromptPanel.tsx');
const inPanel = [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);

// 1. Mọi key trong panel phải là step key hợp lệ — gõ sai 1 chữ là bước biến mất khỏi UI.
for (const key of inPanel) {
  assert.ok(isPromptStepKey(key), `REVIEW_STEPS chứa "${key}" không có trong PROMPT_STEPS`);
}

// 2. Không trùng lặp — trùng thì PromptStepEditor render 2 lần cùng 1 bước, sửa ô này không thấy ô kia đổi.
assert.equal(new Set(inPanel).size, inPanel.length, `REVIEW_STEPS có key trùng: ${inPanel.join(', ')}`);

// 3. Hai chiều phải khớp nhau.
const missing = [...usedInCode].filter((k) => !inPanel.includes(k));
assert.deepEqual(
  missing,
  [],
  `Luồng review gọi AI ở bước ${missing.join(', ')} nhưng panel KHÔNG hiện — không có chỗ sửa prompt`
);
const extra = inPanel.filter((k) => !usedInCode.has(k));
assert.deepEqual(
  extra,
  [],
  `Panel hiện bước ${extra.join(', ')} nhưng luồng review KHÔNG chạy bước đó — sửa xong sẽ không có tác dụng gì`
);

// 4. Mọi bước của panel phải perJob=false: luồng review định danh bằng projectId, bảng ai_prompts
//    chưa có tầng riêng cho nó. perJob=true sẽ khiến PromptStepEditor hiện nút "Lưu cho job này"
//    trong khi panel không truyền jobSlug → nút lưu vào tầng global mà nhãn nói ngược lại.
for (const key of inPanel) {
  const step = PROMPT_STEPS.find((s) => s.key === key)!;
  assert.equal(
    step.perJob,
    false,
    `bước "${key}" đang perJob=true — luồng review không có tầng riêng theo job, xem doc-comment ReviewPromptPanel`
  );
}

console.log(`✅ check-review-prompt-panel: OK (${inPanel.length} bước khớp giữa panel và mã nguồn)`);
