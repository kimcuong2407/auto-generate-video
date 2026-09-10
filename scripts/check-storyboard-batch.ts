/**
 * Self-check: vòng lặp gen ảnh tuần tự + retry (lib/data/storyboardBatch.ts).
 *
 * Vì sao cần: đây là logic quyết định "đốt bao nhiêu lượt gọi Google Flow thật". Sai kiểu đếm
 * nhầm 1 lượt là mỗi loạt 8 ảnh tốn thừa 8 lượt, mà không có lỗi nào báo — chỉ là hoá đơn dài
 * hơn. Bốn ca dễ sai:
 *   - Retry vượt trần → lỗi thật (prompt bị chặn) quay vòng đốt quota.
 *   - Chỉ thử 1 lần rồi bỏ → mất hẳn tác dụng retry, đúng thứ Mr.D yêu cầu.
 *   - Chạy song song thay vì tuần tự → dồn tải lên Flow, đúng thứ vừa bỏ đi.
 *   - Không tôn trọng lệnh Dừng → bấm Dừng xong vẫn bị thử lại 2 lần nữa.
 *
 * Chạy: npm run check:storyboard-batch
 */
import assert from 'node:assert/strict';
import { runStoryboardBatch, type BatchEvent } from '../lib/data/storyboardBatch';
import { STORYBOARD_MAX_ATTEMPTS } from '../lib/constants';
import type { TriggerStoryboardResult } from '../lib/data/storyboardGenerate';

const ok = (sceneId: string): TriggerStoryboardResult => ({ sceneId, ok: true });
const fail = (sceneId: string, error: string): TriggerStoryboardResult => ({ sceneId, ok: false, error });

async function main() {
  // --- 1. Đường thuận: mỗi ảnh gọi ĐÚNG 1 lần, theo ĐÚNG thứ tự, KHÔNG chồng lấn ---
  {
    const calls: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }, { sceneId: 'b' }, { sceneId: 'c' }],
      async (sceneId) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        calls.push(sceneId);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return ok(sceneId);
      },
      () => {}
    );
    assert.deepEqual(calls, ['a', 'b', 'c'], 'phải gen đúng thứ tự danh sách');
    assert.equal(maxConcurrent, 1, 'phải chạy TUẦN TỰ — 2 lượt gọi Flow chồng nhau là dồn tải, đúng thứ vừa bỏ đi');
    assert.deepEqual(res.succeeded, ['a', 'b', 'c']);
    assert.equal(res.failed.length, 0);
  }

  // --- 2. Lỗi tạm thời rồi thành công: phải thử lại, KHÔNG tính là hỏng ---
  {
    let n = 0;
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }],
      async (sceneId) => {
        n += 1;
        return n < 2 ? fail(sceneId, 'timeout') : ok(sceneId);
      },
      () => {}
    );
    assert.equal(n, 2, 'lỗi lần 1 thì phải thử lại lần 2');
    assert.deepEqual(res.succeeded, ['a'], 'thử lại thành công thì tính là xong, không phải hỏng');
    assert.equal(res.failed.length, 0);
  }

  // --- 3. Lỗi liên tục: dừng ĐÚNG ở trần, không đốt thêm lượt Flow nào ---
  {
    let n = 0;
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }],
      async (sceneId) => {
        n += 1;
        return fail(sceneId, 'Flow 500');
      },
      () => {}
    );
    assert.equal(n, STORYBOARD_MAX_ATTEMPTS, `phải thử đúng ${STORYBOARD_MAX_ATTEMPTS} lần rồi bỏ cuộc`);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].error, 'Flow 500', 'phải giữ lỗi của lần thử CUỐI để Mr.D biết vì sao hỏng');
  }

  // --- 4. Người dùng bấm Dừng: KHÔNG được thử lại ---
  {
    let n = 0;
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }],
      async (sceneId) => {
        n += 1;
        return fail(sceneId, 'Đã dừng theo yêu cầu người dùng');
      },
      () => {}
    );
    assert.equal(n, 1, 'bấm Dừng rồi mà vẫn retry là chống lại chính lệnh vừa bấm');
    assert.equal(res.failed.length, 1);
  }

  // --- 5. Một ảnh hỏng KHÔNG được làm chết cả loạt ---
  {
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }, { sceneId: 'b' }, { sceneId: 'c' }],
      async (sceneId) => (sceneId === 'b' ? fail(sceneId, 'Đã dừng theo yêu cầu người dùng') : ok(sceneId)),
      () => {}
    );
    assert.deepEqual(res.succeeded, ['a', 'c'], 'ảnh b hỏng không được chặn ảnh c chạy');
    assert.equal(res.failed.length, 1);
  }

  // --- 6. Chuỗi event: có start/done, mỗi ảnh đúng 1 image-done ---
  {
    const events: BatchEvent[] = [];
    await runStoryboardBatch(
      [{ sceneId: 'a' }, { sceneId: 'b' }],
      async (sceneId) => ok(sceneId),
      (e) => events.push(e)
    );
    assert.equal(events[0].type, 'start', 'event đầu phải là start để UI biết tổng số mà vẽ thanh');
    assert.equal(events[events.length - 1].type, 'done', 'không có done thì client treo chờ mãi');
    assert.equal(
      events.filter((e) => e.type === 'image-done').length,
      2,
      'mỗi ảnh phát đúng 1 image-done — thiếu thì thanh tiến độ kẹt, thừa thì đếm vượt tổng'
    );
    const start = events[0] as Extract<BatchEvent, { type: 'start' }>;
    assert.equal(start.total, 2);
  }

  // --- 7. onEvent ném lỗi (client đóng tab) KHÔNG được giết loạt đang chạy ---
  {
    let n = 0;
    const res = await runStoryboardBatch(
      [{ sceneId: 'a' }, { sceneId: 'b' }],
      async (sceneId) => {
        n += 1;
        return ok(sceneId);
      },
      () => {
        throw new Error('client đã đóng kết nối');
      }
    );
    assert.equal(n, 2, 'client ngắt kết nối thì ảnh còn lại vẫn phải gen cho xong và ghi vào project.json');
    assert.equal(res.succeeded.length, 2);
  }

  // --- 8. Danh sách rỗng: vẫn phát start + done để client không treo ---
  {
    const events: BatchEvent[] = [];
    const res = await runStoryboardBatch([], async (sceneId) => ok(sceneId), (e) => events.push(e));
    assert.equal(res.succeeded.length, 0);
    assert.deepEqual(
      events.map((e) => e.type),
      ['start', 'done'],
      'loạt rỗng vẫn phải đóng bằng done, nếu không client chờ vô hạn rồi báo mất kết nối'
    );
  }

  // --- 9. Mọi caller của 2 route SSE phải ĐỌC HẾT stream, không dùng postJson ---
  // Route trả stream nên fetch() resolve ngay khi header tới, ảnh chưa gen xong cái nào. Caller
  // nào chỉ kiểm res.ok rồi đọc trạng thái sẽ thấy toàn 'generating' và kết luận nhầm cả loạt
  // hỏng — đúng bug đã có ở useAutoPipeline khi 2 route này chuyển từ JSON sang SSE.
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const SSE_ROUTES = ['storyboard/generate-all', 'storyboard/generate-backgrounds'];

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
      }
      return out;
    }

    const files = ['components', 'hooks', 'app', 'lib'].flatMap((d) =>
      walk(path.join(process.cwd(), d))
    );
    const offenders: string[] = [];
    for (const file of files) {
      // Bỏ qua chính file định nghĩa route.
      if (file.includes(path.join('app', 'api'))) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const route of SSE_ROUTES) {
        if (!src.includes(route)) continue;
        // Dòng gọi route phải đi qua helper đọc SSE.
        for (const line of src.split('\n')) {
          if (!line.includes(route)) continue;
          if (/postJson\(|fetch\(/.test(line)) {
            offenders.push(`${path.relative(process.cwd(), file)}: gọi ${route} bằng fetch/postJson thô`);
          }
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Route SSE bị gọi như route JSON — sẽ trả về trước khi ảnh gen xong:\n  ${offenders.join('\n  ')}`
    );
  }

  console.log('✅ check-storyboard-batch: 9/9 pass');
}

main();
