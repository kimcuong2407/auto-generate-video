/**
 * Self-check: chatClient phải chịu được lượt gọi DÀI, nhưng vẫn cắt được lượt gọi TREO.
 *
 * Vì sao cần (ca thật trên production 2026-08-29): lượt sinh script mất ~146s cho ~19k ký tự,
 * sát trần timeout 180s cũ tính trên TỔNG thời gian. Model chậm hơn thường lệ một chút là bị
 * abort giữa chừng dù stream vẫn chảy đều. Tệ hơn: abort xảy ra lúc đang đọc body (header đã về
 * sớm vì stream) nên rơi ra ngoài khối catch của fetch → lỗi thô "This operation was aborted"
 * lọt thẳng lên UI, và vì không mang `status` nên vòng retry coi là lỗi vĩnh viễn, bỏ luôn 2 lần
 * thử còn lại dù thông báo vẫn ghi "đã thử 3 lần".
 *
 * Chạy: npx tsx scripts/check-chat-timeout.ts
 */
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';

process.env.AI_CHAT_API_KEY = 'test-key';
process.env.AI_CHAT_API_MODEL = 'test-model';
process.env.AI_CHAT_API_TIMEOUT_MS = '1000'; // 1s im lặng là quá hạn — để test chạy nhanh
process.env.AI_CHAT_API_MAX_RETRIES = '2';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gửi 1 chunk SSE hợp lệ mang `text`. */
function sseChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/**
 * Server giả lập: `mode` quyết định cách nhả stream.
 * - 'slow-but-alive': nhả chunk đều mỗi 400ms trong ~2.4s → TỔNG vượt timeout 1s nhưng KHÔNG
 *   có khoảng lặng nào quá 1s. Đây chính là hình dạng lượt sinh script thật.
 * - 'hang': gửi 1 chunk rồi im hẳn → phải bị cắt.
 * - 'hang-then-ok': lần gọi đầu treo, các lần sau trả lời ngay → kiểm tra timeout CÓ retry.
 */
function makeServer(mode: 'slow-but-alive' | 'hang' | 'hang-then-ok') {
  let calls = 0;
  const server = http.createServer(async (req, res) => {
    calls += 1;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (mode === 'slow-but-alive') {
      for (let i = 0; i < 6; i++) {
        res.write(sseChunk(`phần ${i} `));
        await sleep(400);
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    if (mode === 'hang') {
      res.write(sseChunk('mở đầu '));
      return; // im hẳn, không end
    }
    if (calls === 1) {
      res.write(sseChunk('mở đầu '));
      return; // lần đầu treo
    }
    res.write(sseChunk('xong sau retry'));
    res.end('data: [DONE]\n\n');
  });
  return server;
}

async function withServer<T>(
  mode: Parameters<typeof makeServer>[0],
  fn: () => Promise<T>
): Promise<T> {
  const server = makeServer(mode);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.AI_CHAT_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Import sau khi set env: chatClient đọc DEFAULT_TIMEOUT_MS lúc module load.
  try {
    return await fn();
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main() {
  const { chatCompletion, ChatApiError } = await import('../lib/ai/chatClient');

  // 1. CỐT LÕI: stream chảy đều suốt 2.4s (gấp 2.4 lần timeout) vẫn phải hoàn tất — timeout đo
  //    KHOẢNG LẶNG, không phải tổng thời gian. Trần cũ tính tổng sẽ fail assert này.
  const slow = await withServer('slow-but-alive', () => chatCompletion('sys', 'user'));
  assert.strictEqual(
    slow,
    'phần 0 phần 1 phần 2 phần 3 phần 4 phần 5 ',
    'stream chảy đều lâu hơn timeout vẫn phải nhận đủ nội dung'
  );

  // 2. Treo thật (im lặng quá timeout) vẫn phải bị cắt — không được chờ vô hạn.
  const started = Date.now();
  const hangErr = await withServer('hang', () =>
    chatCompletion('sys', 'user').then(
      () => null,
      (e) => e as Error
    )
  );
  assert.ok(hangErr instanceof ChatApiError, 'treo phải ném ChatApiError, không phải lỗi thô');
  assert.ok(
    !/this operation was aborted/i.test(hangErr!.message),
    `không được để lọt lỗi thô của AbortController ra UI: ${hangErr!.message}`
  );
  assert.match(hangErr!.message, /không phản hồi thêm/i, 'thông điệp phải nói rõ AI ngừng phản hồi');
  // 3 lần thử × 1s im lặng, cộng backoff 1s + 2s → phải > 3s, và không được vô hạn.
  assert.ok(Date.now() - started >= 3000, 'phải thử lại đủ 3 lần trước khi bỏ cuộc');

  // 3. Timeout là lỗi TẠM THỜI: lần đầu treo, lần thử lại thành công thì phải trả về kết quả.
  //    Trước đây timeout không mang `status` nên bị coi là vĩnh viễn → hỏng ngay lần đầu.
  const recovered = await withServer('hang-then-ok', () => chatCompletion('sys', 'user'));
  assert.strictEqual(recovered, 'xong sau retry', 'timeout phải được retry và phục hồi được');

  console.log('✓ check-chat-timeout: 6/6 pass');
}

main();
