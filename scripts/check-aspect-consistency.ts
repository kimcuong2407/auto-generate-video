/**
 * Self-check: TỈ LỆ KHUNG HÌNH phải nhất quán giữa CODE và PROMPT trên toàn pipeline.
 *
 * Vì sao cần (ca lỗi thật, 10/09/2026): lib/data/backgroundGenerate.ts hard-code
 * `aspect: '16:9'` kèm comment "luôn khung ngang để vẽ lưới 8 ô", trong khi
 * BACKGROUND_SYSTEM_PROMPT lại yêu cầu "Khung dọc". Prompt bảo dọc, code ép ngang → Google
 * trả ảnh NGANG cho project 9:16, và không có gì báo lỗi: assertAspect() ở imageGen.ts chỉ so
 * ảnh với chính tham số aspect được truyền vào, nên ảnh ngang khớp '16:9' và lọt qua sạch sẽ.
 * "Lưới 8 ô" là tàn dư của phiên bản prompt cũ — không prompt nào còn yêu cầu lưới nữa.
 *
 * Check này canh 2 thứ mà TypeScript không bắt được:
 *   1. Không nơi nào trong pipeline gen ảnh được hard-code tỉ lệ — phải lấy từ project.
 *   2. Các prompt hệ thống ra ảnh/video phải nói rõ khung dọc 9:16, không để ngỏ.
 *
 * Đọc file dạng text thay vì gọi hàm: thứ cần canh chính là NỘI DUNG CHỮ trong prompt và
 * literal trong code, không phải hành vi runtime.
 *
 * Chạy: npx tsx scripts/check-aspect-consistency.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** Bỏ dòng comment để không bắt nhầm tỉ lệ nêu trong phần giải thích. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// 1. Không hard-code tỉ lệ ở các khâu gen ảnh của luồng review.
// ---------------------------------------------------------------------------
const IMAGE_GEN_FILES = ['lib/data/backgroundGenerate.ts', 'lib/data/storyboardGenerate.ts'];

for (const rel of IMAGE_GEN_FILES) {
  const code = stripComments(read(rel));
  const hardcoded = code.match(/aspect:\s*['"](?:9:16|16:9)['"]/g);
  assert.equal(
    hardcoded,
    null,
    `${rel}: hard-code tỉ lệ (${hardcoded?.join(', ')}) — phải truyền project.aspectRatio, ` +
      `nếu không ảnh sẽ ngược khung với video và assertAspect() không bắt được.`
  );
  assert.ok(
    /aspect:\s*project\.aspectRatio/.test(code),
    `${rel}: phải truyền \`aspect: project.aspectRatio\` cho khâu gen ảnh.`
  );
}

// ---------------------------------------------------------------------------
// 2. Prompt hệ thống phải ép khung dọc 9:16, không để ngỏ tỉ lệ.
// ---------------------------------------------------------------------------
const promptDefaults = read('lib/livestream/promptDefaults.ts');

/**
 * Cắt đúng thân 1 template literal `const NAME = \`...\`;` để check đúng phạm vi.
 * Mọi prompt nay đều `export` từ promptDefaults.ts (đã gom về registry), nhưng vẫn nhận cả bản
 * module-local phòng khi có prompt mới chưa kịp gom.
 */
function promptBody(src: string, name: string): string {
  const m = new RegExp(`(?:export\\s+)?const ${name} = \``).exec(src);
  const start = m ? m.index : -1;
  assert.notEqual(start, -1, `Không tìm thấy ${name} — prompt bị đổi tên?`);
  const from = src.indexOf('`', start) + 1;
  const end = src.indexOf('`;', from);
  assert.notEqual(end, -1, `${name}: không tìm thấy điểm kết thúc template literal.`);
  return src.slice(from, end);
}

const cases: { label: string; body: string }[] = [
  { label: 'BACKGROUND_SYSTEM_PROMPT', body: promptBody(promptDefaults, 'BACKGROUND_SYSTEM_PROMPT') },
  {
    label: 'STORYBOARD_PROMPT_SYSTEM_PROMPT',
    body: promptBody(promptDefaults, 'STORYBOARD_PROMPT_SYSTEM_PROMPT'),
  },
  // Prompt sinh kịch bản luồng review: đã chuyển từ hằng module-local trong route sang registry
  // (promptDefaults.ts) để Mr.D sửa được ở UI. Ràng buộc 9:16 vẫn phải nằm trong bản MẶC ĐỊNH —
  // đây là thứ mọi project ăn khi chưa ai sửa gì.
  {
    label: 'REVIEW_SCRIPT_SYSTEM_PROMPT (sinh veoPrompt)',
    body: promptBody(promptDefaults, 'REVIEW_SCRIPT_SYSTEM_PROMPT'),
  },
];

for (const { label, body } of cases) {
  assert.ok(body.includes('9:16'), `${label}: phải ghi rõ tỉ lệ 9:16, không được để model tự đoán.`);
  assert.ok(
    /[Dd]ọc|DỌC/.test(body),
    `${label}: phải nói rõ đây là khung DỌC — chỉ ghi "9:16" trần dễ bị model hiểu thành nhãn.`
  );
}

// 3. Hai prompt ra ẢNH phải cấm thẳng khung ngang (ca lỗi thật: ảnh nền ra ngang).
for (const label of ['BACKGROUND_SYSTEM_PROMPT', 'STORYBOARD_PROMPT_SYSTEM_PROMPT']) {
  const body = cases.find((c) => c.label === label)!.body;
  assert.ok(
    /KHÔNG khung ngang|KHÔNG dàn hàng ngang/.test(body),
    `${label}: phải cấm rõ bố cục ngang, nếu không model vẫn dựng cảnh ngang rồi crop.`
  );
}

// 4. Ghi chú trên UI không được nói ảnh Bước 3 dùng khung ngang (đã sai suốt, gây hiểu nhầm).
const uploadStep = read('components/steps/UploadStep.tsx');
assert.ok(
  !/lưới 8 ô/.test(uploadStep),
  'UploadStep.tsx: còn ghi chú "lưới 8 ô" — không prompt nào còn yêu cầu lưới, ghi chú này sai sự thật.'
);

console.log('OK — aspect consistency: 4/4 nhóm check passed');
