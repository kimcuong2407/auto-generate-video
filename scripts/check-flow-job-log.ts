/**
 * Self-check: log lượt gen video (bảng flow_job_logs) ghi ĐỦ 4 nhánh và không làm hỏng đường gen.
 *
 * Vì sao cần — bốn cách hỏng, tất cả đều im lặng:
 *
 * 1. Quên nhánh LỖI. Đây là nhánh dễ quên nhất và cũng đáng giá nhất: bảng chỉ có lượt thành công
 *    thì một cảnh fail 3 lần trông y hệt cảnh chưa ai bấm gen — đúng câu hỏi mà log sinh ra để
 *    trả lời.
 * 2. `await recordFlowJob` thay vì `void`. Chạy vẫn đúng nên không ai thấy, nhưng mỗi lượt gen
 *    cộng thêm một vòng DB × 32 đoạn.
 * 3. recordFlowJob ném → giết luôn lượt gen. Đổi tính năng quan sát lấy một hồi quy thật.
 * 4. Ghi prompt THÔ mà không đánh dấu → người đọc tưởng đó là chuỗi Google nhận, rồi soát prompt
 *    trên một bản không tồn tại.
 *
 * Kiểm bằng quét mã nguồn: ghi log là hiệu ứng phụ trong đường gen thật, dựng lại bằng hàm thuần
 * thì phải giả lập cả Flow API, mà chạy thật thì cần DB + tài khoản Google.
 *
 * Chạy: npm run check:flow-job-log
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// --- 1. recordFlowJob: không ném, DB tắt thì bỏ qua ---
const mod = read('lib/flow/flowJobLog.ts');
const fn = mod.slice(mod.indexOf('export async function recordFlowJob'));
assert.match(fn, /try\s*\{/, 'recordFlowJob phải bọc try/catch');
assert.match(fn, /catch\s*\(/, 'recordFlowJob phải NUỐT lỗi, không để nó nổi lên đường gen');
assert.ok(
  !/throw/.test(fn),
  'recordFlowJob TUYỆT ĐỐI không được ném — log hỏng không được làm fail lượt gen'
);
assert.match(fn, /if \(!DB_ENABLED\) return;/, 'DB chưa cấu hình thì bỏ qua, không phải lỗi');
// Ghi UTC như mọi cột datetime khác (lib/db/datetime.ts) — ghi giờ máy thì VPS và local lệch nhau.
assert.match(fn, /toISOString\(\)/, 'createdAt phải ghi UTC, hiển thị mới đổi sang +7');

// --- 2. Cả 4 nhánh đều ghi log ---
// [file, số lời gọi tối thiểu, nhãn để báo lỗi cho dễ hiểu]
const HOOKS: Array<[string, string]> = [
  ['lib/data/sceneGenerate.ts', 'Video Review'],
  ['lib/livestream/segmentGenerate.ts', 'Livestream'],
];
for (const [file, label] of HOOKS) {
  const src = read(file);
  const calls = src.match(/recordFlowJob\(/g) ?? [];
  assert.equal(
    calls.length,
    2,
    `${label} (${file}): phải có ĐÚNG 2 lời gọi recordFlowJob (thành công + lỗi), đang có ${calls.length}`
  );
  // Nhánh lỗi nhận ra bằng errorKind — nhánh thành công không bao giờ set nó.
  assert.match(
    src,
    /errorKind:/,
    `${label}: nhánh LỖI phải ghi log kèm errorKind, nếu không lượt fail biến mất khỏi bảng`
  );
  // errorKind phải suy từ cờ đã tính sẵn, không so lại chuỗi lỗi (so chuỗi là đoán).
  assert.match(
    src,
    /errorKind: quota \?/,
    `${label}: errorKind phải lấy từ biến quota/mcpDown đã tính, không so chuỗi lỗi lần nữa`
  );
  // Fire-and-forget: `void recordFlowJob(` hoặc `void <promise>.then(recordFlowJob)`.
  assert.ok(
    /void recordFlowJob\(/.test(src) || /void resolveLivestreamKind\([\s\S]{0,80}recordFlowJob/.test(src),
    `${label}: phải gọi bằng void (fire-and-forget) — await sẽ cộng độ trễ DB vào mỗi lượt gen`
  );
  // Prompt thô PHẢI đi kèm cờ, không để người đọc tưởng là bản đã gửi.
  assert.match(
    src,
    /promptIsRaw: true/,
    `${label}: nhánh lỗi ghi prompt thô thì phải đặt promptIsRaw = true`
  );
}

// --- 3. Prompt cuối phải được trả ra khỏi generateSceneVideo ---
// Không có nó thì mọi log đều là bản thô, và bảng mất đúng giá trị lớn nhất của nó.
assert.match(
  read('lib/googleFlow/videoGen.ts'),
  /finalPrompt\?: string;/,
  'GenerateVideoResult phải có finalPrompt'
);
for (const f of ['lib/googleFlow/flowJobs.ts', 'lib/googleFlow/mcpJobs.ts']) {
  assert.match(
    read(f),
    /finalPrompt: prompt/,
    `${f}: phải trả finalPrompt — thiếu ở một luồng thì cùng một cảnh cho hai bằng chứng khác nhau`
  );
}
// Cả hai nhánh của luồng batchexecute (project cũ + project tạo lại sau 404) đều phải trả.
const flowJobs = read('lib/googleFlow/flowJobs.ts');
assert.equal(
  (flowJobs.match(/finalPrompt: prompt/g) ?? []).length,
  2,
  'flowJobs phải trả finalPrompt ở CẢ 2 nhánh (project hiện tại và project tạo lại sau 404)'
);

// --- 4. negativePrompt của livestream lấy 1 lần, dùng cho cả gen lẫn log ---
// Gọi loadPromptSet lần nữa để log vừa thừa một lượt đọc DB, vừa có thể ra chuỗi KHÁC nếu prompt
// vừa được sửa giữa chừng — log sẽ ghi thứ không phải thứ đã gửi.
const seg = read('lib/livestream/segmentGenerate.ts');
assert.match(seg, /const negativePrompt = \(await loadPromptSet/, 'negativePrompt phải nhấc ra biến');
assert.equal(
  (seg.match(/loadPromptSet\(job\.slug\)/g) ?? []).length,
  1,
  'chỉ được gọi loadPromptSet MỘT lần trong đường gen đoạn'
);

console.log('✅ check-flow-job-log: OK (4 nhánh đều ghi, không ném, fire-and-forget, prompt cuối có thật)');
