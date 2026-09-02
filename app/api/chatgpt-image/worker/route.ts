import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { claimNextJob, finishJob, failJob, readJob, reapStaleJobs } from '@/lib/chatgptImage/jobStore';
import { markExtensionPolled } from '@/lib/chatgptImage/extensionPresence';
import { buildPrompt } from '@/lib/chatgptImage/domScript';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS: extension gọi cross-origin từ service worker (origin chrome-extension://) — cùng lý do
// và cùng cấu hình với /api/flow-auth/token-request.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Ghi cùng chỗ với runner.ts để mọi thứ phía sau (copy ra outputs/, upload R2) không phải biết
 *  ảnh do Playwright hay extension tạo ra. */
const TMP_DIR = path.join(process.cwd(), 'data', 'tmp', 'chatgpt-image');

/**
 * Ngưỡng coi job 'running' là đã chết. Bằng STALE_RUNNING_MS của worker.ts.
 *
 * Vì sao phải reap TẠI ĐÂY: worker.ts chỉ reap đúng một lần lúc server khởi động. Job của
 * đường Playwright còn được vòng poll 5s ngó tới, chứ job extension thì không có vòng lặp
 * server-side nào — đóng Chrome giữa chừng là job nằm 'running' tới lần restart kế tiếp, và
 * người dùng thử lại cũng vô ích. Extension poll đều 1.5s nên đây là nhịp sẵn có, không cần
 * dựng thêm timer.
 */
// PHẢI dài hơn trần cứng 20 phút của script trong trang. Ngắn hơn thì reap giết nhầm job đang
// chạy hợp lệ ở giữa chừng, và người dùng thấy "Job bị bỏ dở" dù tab vẫn đang vẽ.
const STALE_RUNNING_MS = 25 * 60_000;

/** Giãn cách giữa 2 lần reap — poll 1.5s mà lần nào cũng quét bảng thì phí. */
const REAP_INTERVAL_MS = 60_000;
let lastReapAt = 0;

/** Ảnh ref gửi cho extension dưới dạng data URL — Chrome không đọc được file trên đĩa server. */
const REF_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Ext hợp lệ cho ảnh kết quả — chặn extension ghi file tuỳ ý lên đĩa server. */
const RESULT_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp']);

async function readRefImages(paths: string[]): Promise<Array<{ name: string; dataUrl: string }>> {
  const out: Array<{ name: string; dataUrl: string }> = [];
  for (const abs of paths) {
    try {
      const buf = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const mime = REF_MIME[ext] || 'image/jpeg';
      out.push({ name: path.basename(abs), dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
    } catch {
      // Thiếu 1 ảnh ref không đáng huỷ cả job — gen với số ảnh còn lại vẫn hơn là fail hẳn.
    }
  }
  return out;
}

/**
 * GET — extension hỏi "có việc không".
 *
 * Luôn markExtensionPolled() TRƯỚC mọi thứ khác, kể cả khi không có job: đây là nhịp tim để
 * server biết Chrome còn mở. Đặt sau nhánh "không có job" thì lúc rảnh việc server lại tưởng
 * extension chết, rồi từ chối luôn lệnh gen kế tiếp.
 */
export async function GET(req: NextRequest) {
  markExtensionPolled();

  // ?probe=<jobId>: extension đang có job chạy trong tab, chỉ hỏi xem xong chưa — KHÔNG claim
  // job mới. Trang tự POST kết quả nên server biết trước extension; trả lời ở đây giúp nó nhả
  // cờ ngay thay vì chờ hết deadline 11 phút.
  const probeId = req.nextUrl.searchParams.get('probe');
  if (probeId) {
    const j = await readJob(probeId);
    return json({
      job: null,
      jobDone: !j || j.status === 'done' || j.status === 'failed',
      jobFailed: j?.status === 'failed',
    });
  }

  // Dọn job chết trước khi claim: không dọn thì job kẹt 'running' chiếm chỗ vĩnh viễn.
  const now = Date.now();
  if (now - lastReapAt > REAP_INTERVAL_MS) {
    lastReapAt = now;
    await reapStaleJobs(STALE_RUNNING_MS).catch(() => {});
  }

  const job = await claimNextJob('extension', 'extension');
  if (!job) return json({ job: null });

  const refImages = await readRefImages(job.refImagePaths);
  return json({
    job: {
      id: job.id,
      // Dùng chung buildPrompt với bản Playwright để prompt gửi lên ChatGPT giống hệt nhau —
      // hai đường gen mà prompt khác nhau thì so sánh chất lượng ảnh thành vô nghĩa.
      prompt: buildPrompt({
        prompt: job.prompt,
        aspect: job.aspect,
        hasRefImages: refImages.length > 0,
      }),
      aspect: job.aspect,
      refImages,
    },
  });
}

/**
 * POST — extension nộp kết quả (ảnh base64) hoặc báo lỗi.
 *
 * Ghi file rồi finishJob() để generateChatgptImage() đang poll DB nhận được path, y hệt đường
 * Playwright. Không đụng gì tới R2: call-site phía trên vẫn copy ra outputs/ và upload như cũ.
 */
export async function POST(req: NextRequest) {
  markExtensionPolled();

  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string;
    imageBase64?: string;
    ext?: string;
    error?: string;
  };

  const jobId = body.jobId?.trim();
  if (!jobId) return json({ error: 'Thiếu jobId' }, 400);

  const job = await readJob(jobId);
  if (!job) return json({ error: 'Job không tồn tại' }, 404);
  // Job đã kết thúc (thường do reapStaleJobs dọn khi Chrome đóng giữa chừng) — nhận kết quả
  // muộn sẽ ghi đè trạng thái đã chốt, nên bỏ qua và nói rõ cho extension.
  if (job.status !== 'running') {
    return json({ ok: false, ignored: true, reason: `job đang ở trạng thái "${job.status}"` });
  }

  if (body.error || !body.imageBase64) {
    await failJob(jobId, body.error || 'Extension không trả về ảnh');
    return json({ ok: true });
  }

  const ext = (body.ext || 'png').toLowerCase().replace(/^\./, '');
  if (!RESULT_EXTS.has(ext)) {
    await failJob(jobId, `Đuôi ảnh không hợp lệ: ${ext}`);
    return json({ error: 'Đuôi ảnh không hợp lệ' }, 400);
  }

  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    const dest = path.join(TMP_DIR, `img-${crypto.randomBytes(6).toString('hex')}.${ext}`);
    await fs.writeFile(dest, Buffer.from(body.imageBase64, 'base64'));
    await finishJob(jobId, dest);
    return json({ ok: true });
  } catch (err) {
    const msg = (err as Error).message;
    await failJob(jobId, `Ghi ảnh thất bại: ${msg}`);
    return json({ error: msg }, 500);
  }
}
