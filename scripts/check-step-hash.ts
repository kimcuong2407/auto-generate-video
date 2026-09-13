/**
 * Self-check: hash trên URL (#upload, #script...) phải map 1-1 với step của trang project.
 *
 * Vì sao cần: Mr.D F5 ở step 4 mà quay về step 1 thì mất hết ngữ cảnh đang xem. Cơ chế phục hồi
 * dựa vào 2 mảnh phải khớp nhau: STEP_SLUGS (Sidebar) và số nhánh `currentStep === n` trong page.
 * Thêm 1 step mà quên slug => hashFromStep trả '' => F5 rơi về step 1 im lặng, không ai báo lỗi.
 *
 * Kiểm tra thuần tĩnh (đọc source + gọi helper), không cần chạy app.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STEP_LABELS, STEP_SLUGS, hashFromStep, stepFromHash } from '../components/Sidebar';

const PAGE = 'app/projects/[id]/page.tsx';
const src = readFileSync(PAGE, 'utf8');

// 1. Số slug == số step hiển thị ở sidebar.
assert.equal(
  STEP_SLUGS.length,
  STEP_LABELS.length,
  `STEP_SLUGS (${STEP_SLUGS.length}) phải cùng số lượng với STEP_LABELS (${STEP_LABELS.length})`,
);

// 2. Slug không trùng nhau, không rỗng, chỉ gồm [a-z0-9-] để nằm an toàn trong hash URL.
const seen = new Set<string>();
for (const slug of STEP_SLUGS) {
  assert.match(slug, /^[a-z0-9-]+$/, `slug "${slug}" chứa ký tự không hợp lệ cho hash URL`);
  assert.ok(!seen.has(slug), `slug "${slug}" bị trùng — hai step sẽ tranh nhau cùng 1 URL`);
  seen.add(slug);
}

// 3. Round-trip: step -> hash -> step phải về đúng chính nó.
for (let step = 1; step <= STEP_SLUGS.length; step++) {
  const hash = hashFromStep(step);
  assert.ok(hash.startsWith('#'), `hashFromStep(${step}) phải bắt đầu bằng '#', nhận "${hash}"`);
  assert.equal(stepFromHash(hash), step, `round-trip hỏng ở step ${step} (hash="${hash}")`);
}

// 4. Hash lạ / rỗng -> null để page giữ nguyên step hiện tại thay vì nhảy lung tung.
assert.equal(stepFromHash(''), null);
assert.equal(stepFromHash('#'), null);
assert.equal(stepFromHash('#khong-ton-tai'), null);
assert.equal(stepFromHash(`#${STEP_SLUGS[0]!.toUpperCase()}`), 1, 'hash phải nhận diện không phân biệt hoa thường');

// 5. Số nhánh render trong page khớp số slug — thêm step mới mà quên slug sẽ đỏ ở đây.
const branches = [...src.matchAll(/currentStep === (\d+)/g)].map((m) => Number(m[1]));
const uniqueBranches = [...new Set(branches)].sort((a, b) => a - b);
assert.deepEqual(
  uniqueBranches,
  Array.from({ length: STEP_SLUGS.length }, (_, i) => i + 1),
  `${PAGE} render các step ${JSON.stringify(uniqueBranches)} nhưng STEP_SLUGS chỉ có ${STEP_SLUGS.length} slug`,
);

// 6. Page phải thực sự nối 2 chiều: đọc hash lúc mount + ghi hash khi đổi step.
assert.ok(src.includes('stepFromHash'), `${PAGE} không đọc hash -> F5 sẽ mất step đang xem`);
assert.ok(src.includes('hashFromStep'), `${PAGE} không ghi hash -> URL không phản ánh step`);
assert.ok(src.includes("addEventListener('hashchange'"), `${PAGE} không nghe hashchange -> nút Back của trình duyệt không đổi step`);
assert.ok(src.includes('replaceState'), `${PAGE} phải dùng replaceState để không nhồi history rác`);

// 7. Không còn chỗ nào đổi step vòng qua setCurrentStep (bỏ qua việc cập nhật URL).
const leaked = [...src.matchAll(/on(?:StepClick|GoStep)=\{setCurrentStep\}/g)];
assert.equal(leaked.length, 0, `${PAGE} còn truyền setCurrentStep trực tiếp — phải dùng goStep để URL được cập nhật`);

console.log(`OK check-step-hash: ${STEP_SLUGS.length} step map 1-1 với hash (${STEP_SLUGS.map((s) => '#' + s).join(', ')})`);
