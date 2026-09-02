/**
 * Self-check: MỌI bước trong PROMPT_STEPS phải thực sự được nối vào registry.
 *
 * Vì sao cần: thêm tham số `systemPrompt` vào hàm nhưng quên sửa THÂN hàm (vẫn truyền hằng cũ cho
 * chatCompletion) là lỗi typecheck KHÔNG bắt được — code biên dịch sạch, chạy không lỗi, chỉ là
 * prompt người dùng sửa bị bỏ qua im lặng. Đúng ca đã suýt lọt khi nối 3 hàm
 * describeProductAppearance / reviewScriptQuality / shortenOverlongSegments.
 *
 * Cách kiểm: quét mã nguồn, mỗi lời gọi chatCompletion/generateScriptText trong lib/livestream
 * phải lấy system prompt từ registry (`loadPromptSet(...).get(...)` hoặc biến `systemPrompt`),
 * KHÔNG được truyền thẳng hằng *_SYSTEM_PROMPT.
 *
 * Chạy: npm run check:prompt-wiring
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROMPT_STEPS } from '../lib/livestream/promptSteps';

const DIR = path.join(process.cwd(), 'lib/livestream');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts'));

// --- 1. Không call-site nào truyền thẳng hằng prompt cho AI ---
// Bắt đúng dạng `chatCompletion(TEN_HANG,` / `generateScriptText(TEN_HANG,` kể cả xuống dòng.
const CALL_WITH_CONST = /(?:chatCompletion|generateScriptText)\(\s*([A-Z][A-Z0-9_]*_PROMPT)\b/g;
const offenders: string[] = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const m of src.matchAll(CALL_WITH_CONST)) {
    offenders.push(`${f}: truyền thẳng ${m[1]} cho AI thay vì lấy từ registry`);
  }
}
assert.deepEqual(
  offenders,
  [],
  `Có bước chưa nối vào registry — prompt người dùng sửa sẽ bị bỏ qua IM LẶNG:\n  ${offenders.join('\n  ')}`
);

// --- 2. Mỗi step key phải xuất hiện ở ít nhất 1 chỗ đọc registry trong mã nguồn ---
// Quét cả lib/livestream lẫn app/api (route sinh script đọc prompt rồi truyền xuống).
const SEARCH_DIRS = [DIR, path.join(process.cwd(), 'app/api/livestream')];
function readAll(dir: string): string {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out += readAll(p);
    else if (entry.name.endsWith('.ts')) out += fs.readFileSync(p, 'utf8');
  }
  return out;
}
const allSrc = SEARCH_DIRS.map(readAll).join('\n');
for (const step of PROMPT_STEPS) {
  assert.ok(
    allSrc.includes(`get('${step.key}'`),
    `bước "${step.key}" khai báo trong PROMPT_STEPS nhưng KHÔNG chỗ nào đọc từ registry — sửa prompt bước này sẽ không có tác dụng`
  );
}

// --- 3. Bước chạy trước khi có job phải đọc registry KHÔNG kèm jobSlug ---
// loadPromptSet(job.slug) cho bước global-only nghĩa là đang chờ một override không bao giờ tồn tại.
for (const step of PROMPT_STEPS.filter((s) => !s.perJob)) {
  const re = new RegExp(`loadPromptSet\\([^)]+\\)\\)\\.get\\('${step.key}'`);
  assert.ok(
    !re.test(allSrc),
    `bước "${step.key}" chạy trước khi job tồn tại nên phải gọi loadPromptSet() không tham số`
  );
}

console.log(`✅ check-prompt-wiring: OK (${PROMPT_STEPS.length} bước đều đọc từ registry)`);
