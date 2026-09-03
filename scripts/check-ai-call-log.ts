/**
 * Self-check: cơ chế gắn nhãn + cắt tỉa log lượt gọi AI (lib/ai/callLog.ts).
 *
 * Vì sao cần 4 nhóm dưới đây — mỗi nhóm khoá lại một lỗi mà typecheck KHÔNG bắt được và cũng
 * không lộ ra khi bấm thử một lần:
 *
 * 1. ALS rò rỉ ra ngoài withAiCallContext → lượt gọi SAU bị gán nhãn của lượt trước.
 * 2. Hai lượt song song lẫn nhãn → log gắn sai sản phẩm. Đây là ca thật: route sinh script chạy
 *    nhiều sản phẩm, và nhiều request có thể chạy đồng thời trên cùng process.
 * 3. Off-by-one khi cắt tỉa → XOÁ DỮ LIỆU THẬT (giữ 19 hoặc 21 lượt thay vì 20).
 * 4. Thêm bước AI mới mà quên bọc withAiCallContext → bước đó im lặng không có log, Mr.D mở mục
 *    ra thấy trống mà không biết vì sao. Cùng loại lỗi check-prompt-wiring.ts đã phải khoá.
 *
 * Không đụng DB: chỉ kiểm hàm thuần + quét mã nguồn.
 *
 * Chạy: npm run check:ai-call-log
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KEEP_RUNS,
  currentAiCallContext,
  rowIdsToDelete,
  withAiCallContext,
} from '../lib/ai/callLog';
import { PROMPT_STEPS } from '../lib/livestream/promptSteps';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  // --- 1. Context xuyên qua await lồng nhau, và KHÔNG rò rỉ ra ngoài ---
  assert.equal(currentAiCallContext(), undefined, 'chưa vào context mà đã có nhãn');

  const seen: (string | undefined)[] = [];
  await withAiCallContext({ stepKey: 'script', jobSlug: 'job-1', productId: 'p1' }, async () => {
    await sleep(0);
    // Lồng thêm 1 tầng hàm async: đúng hình dạng thật (route → ensureX → chatCompletion).
    await (async () => {
      await sleep(0);
      seen.push(currentAiCallContext()?.stepKey);
      seen.push(currentAiCallContext()?.jobSlug);
    })();
  });
  assert.deepEqual(seen, ['script', 'job-1'], 'ALS mất context qua await lồng nhau');
  assert.equal(
    currentAiCallContext(),
    undefined,
    'ALS RÒ RỈ ra ngoài withAiCallContext — lượt gọi sau sẽ bị gán nhãn của lượt trước'
  );

  // --- 2. Hai lượt SONG SONG không lẫn nhãn ---
  // Cố ý cho lượt p1 ngủ lâu hơn để 2 lượt đan xen nhau trên cùng event loop.
  const [a, b] = await Promise.all([
    withAiCallContext({ stepKey: 'script', jobSlug: 'j', productId: 'p1' }, async () => {
      await sleep(5);
      return currentAiCallContext()!.productId;
    }),
    withAiCallContext({ stepKey: 'script', jobSlug: 'j', productId: 'p2' }, async () => {
      await sleep(1);
      return currentAiCallContext()!.productId;
    }),
  ]);
  assert.deepEqual([a, b], ['p1', 'p2'], 'hai lượt song song lẫn nhãn — log sẽ gắn sai sản phẩm');

  // --- 3. Cắt tỉa: off-by-one ở đây XOÁ DỮ LIỆU THẬT ---
  // Danh sách rowId sắp GIẢM DẦN (mới nhất trước), đúng thứ tự query dùng.
  const desc = (n: number) => Array.from({ length: n }, (_, i) => n - i);

  assert.deepEqual(rowIdsToDelete(desc(3), 20), [], 'chưa đủ 20 lượt mà đã xoá');
  assert.deepEqual(rowIdsToDelete(desc(20), 20), [], 'đúng 20 lượt thì không được xoá gì');
  assert.deepEqual(
    rowIdsToDelete(desc(22), 20),
    [2, 1],
    'phải xoá đúng 2 lượt CŨ NHẤT và giữ 20 lượt mới'
  );
  // Giữ đúng KEEP_RUNS lượt, không phải KEEP_RUNS-1 hay +1.
  assert.equal(desc(50).length - rowIdsToDelete(desc(50), KEEP_RUNS).length, KEEP_RUNS,
    `sau khi cắt phải còn đúng ${KEEP_RUNS} lượt`);
  // Lượt mới nhất TUYỆT ĐỐI không được nằm trong danh sách xoá.
  assert.ok(!rowIdsToDelete(desc(50), KEEP_RUNS).includes(50), 'cắt tỉa xoá nhầm lượt mới nhất');

  // --- 4. Mọi bước AI text phải được bọc withAiCallContext ---
  // 2 bước này KHÔNG có lượt gọi AI text để log (background ra ảnh, negative_video chỉ là mảnh
  // string ghép vào prompt gen video) — xem NO_RUN_LOG ở components/prompts/AiCallLogView.tsx.
  const NO_LOG = new Set(['background', 'negative_video']);

  const src = [
    path.join(process.cwd(), 'lib/livestream'),
    path.join(process.cwd(), 'app/api/livestream'),
  ]
    .map(readAllTs)
    .join('\n');

  for (const step of PROMPT_STEPS) {
    if (NO_LOG.has(step.key)) {
      assert.ok(
        !src.includes(`stepKey: '${step.key}'`),
        `bước "${step.key}" không có lượt gọi AI text nhưng lại được bọc withAiCallContext`
      );
      continue;
    }
    assert.ok(
      src.includes(`stepKey: '${step.key}'`),
      `bước "${step.key}" chưa được bọc withAiCallContext — sẽ KHÔNG có log, mục "Lượt chạy gần nhất" hiện trống`
    );
  }

  console.log(`✅ check-ai-call-log: OK (ALS không rò rỉ, cắt tỉa giữ đúng ${KEEP_RUNS}, ${PROMPT_STEPS.length - NO_LOG.size} bước đã bọc)`);
}

function readAllTs(dir: string): string {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out += readAllTs(p);
    else if (entry.name.endsWith('.ts')) out += fs.readFileSync(p, 'utf8');
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
