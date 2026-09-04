/**
 * Self-check cho nút "chạy riêng từng bước AI" ở job detail.
 *
 * Thứ dễ hỏng nhất là BA DANH SÁCH BƯỚC nằm ở ba file khác nhau trôi lệch nhau:
 *   - RUNNABLE_STEPS  — app/api/livestream/[id]/steps/[step]/route.ts (bước route chịu chạy)
 *   - RUNNABLE        — components/livestream/PromptSettingsPanel.tsx (bước hiện nút)
 *   - PREVIEWABLE     — cùng file trên (bước mở được modal xem trước)
 *   - EXTRA_STEPS     — app/api/livestream/[id]/preview-prompt/route.ts (bước dựng được preview)
 *
 * Mọi nút chạy đều đi QUA modal xem trước, nên bắt buộc RUNNABLE ⊆ PREVIEWABLE ⊆ (EXTRA_STEPS +
 * background/script). Lệch một mắt xích là bấm nút ra lỗi 400 giữa chừng — mà chỉ lộ ra lúc chạy
 * thật, không có gì bắt được lúc build vì cả bốn đều là mảng chuỗi rời.
 *
 * Đọc thẳng từ source thay vì import: hai file kia là route/component Next (JSX + alias @/), tsx
 * chạy trực tiếp sẽ vỡ. Regex đủ dùng vì các hằng này đều khai báo một dòng, dạng literal.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isPromptStepKey } from '../lib/livestream/promptSteps';
import { pickProductLockRefPaths } from '../lib/livestream/productLock';

const ROOT = process.cwd();

/** Lấy mảng chuỗi của một hằng khai báo dạng `const NAME = ['a', 'b'] ...`. */
function readStringArray(relFile: string, constName: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  const m = new RegExp(`${constName}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  assert.ok(m, `Không tìm thấy hằng ${constName} trong ${relFile}`);
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const runnableRoute = readStringArray(
  'app/api/livestream/[id]/steps/[step]/route.ts',
  'RUNNABLE_STEPS'
);
const runnableUi = readStringArray(
  'components/livestream/PromptSettingsPanel.tsx',
  'RUNNABLE'
);
const previewable = readStringArray(
  'components/livestream/PromptSettingsPanel.tsx',
  'PREVIEWABLE'
);
const extraSteps = readStringArray(
  'app/api/livestream/[id]/preview-prompt/route.ts',
  'EXTRA_STEPS'
);

// 1. Nút hiện trên UI phải khớp đúng bước route chịu chạy — thừa một bên là bấm ra 400, thiếu là
//    có route mà không ai gọi được.
assert.deepEqual(
  [...runnableUi].sort(),
  [...runnableRoute].sort(),
  `RUNNABLE (UI) lệch RUNNABLE_STEPS (route): UI=${runnableUi} route=${runnableRoute}`
);

// 2. Mọi bước chạy được phải preview được (nút chạy đi qua modal xem trước).
for (const step of runnableUi) {
  assert.ok(previewable.includes(step), `Bước "${step}" chạy được nhưng KHÔNG có trong PREVIEWABLE`);
}

// 3. Mọi bước preview được phải được route preview-prompt dựng payload.
const previewSupported = new Set([...extraSteps, 'background', 'script', 'segment']);
for (const step of previewable) {
  assert.ok(
    previewSupported.has(step),
    `Bước "${step}" nằm trong PREVIEWABLE nhưng preview-prompt không dựng được (sẽ ra lỗi 400)`
  );
}

// 4. Mọi step key phải là bước AI có thật — gõ sai tên là nút im lặng không làm gì.
for (const step of [...runnableRoute, ...previewable]) {
  if (step === 'segment') continue; // 'segment' là step của preview, không phải PromptStepKey
  assert.ok(isPromptStepKey(step), `"${step}" không phải bước AI hợp lệ (xem PROMPT_STEPS)`);
}

// 5. pickProductLockRefPaths — phép giao dùng chung cho product_lock lẫn product_visual. Sai ở đây
//    thì bước product_visual đi tả người mẫu/căn phòng thay vì tả món hàng.
const A = 'inputs/sp-1.jpg';
const B = 'inputs/sp-2.jpg';
const MODEL = 'inputs/nguoi-mau.jpg';

assert.deepEqual(
  pickProductLockRefPaths({ selectedRefImagePaths: [A, B], scriptRefPaths: [] }),
  [A, B],
  'scriptRefPaths rỗng → lấy toàn bộ ảnh sản phẩm đã chọn'
);
assert.deepEqual(
  pickProductLockRefPaths({ selectedRefImagePaths: [A, B], scriptRefPaths: [B] }),
  [B],
  'có scriptRefPaths → chỉ lấy phần giao'
);
assert.deepEqual(
  pickProductLockRefPaths({ selectedRefImagePaths: [A], scriptRefPaths: [MODEL] }),
  [],
  'ảnh người mẫu KHÔNG thuộc ảnh sản phẩm đã chọn → phải bị loại hết'
);
assert.deepEqual(
  pickProductLockRefPaths({ selectedRefImagePaths: [A, B], scriptRefPaths: [MODEL, A] }),
  [A],
  'lọc bỏ ảnh mẫu, giữ đúng ảnh sản phẩm được tick'
);
assert.deepEqual(
  pickProductLockRefPaths({ selectedRefImagePaths: [] }),
  [],
  'chưa chọn ảnh nào → rỗng (route phải báo lỗi thay vì gọi AI)'
);

console.log(
  `✅ check-step-run-routes: ${runnableUi.length} bước chạy lẻ (${runnableUi.join(', ')}) khớp route + preview; phép giao ảnh đúng.`
);
