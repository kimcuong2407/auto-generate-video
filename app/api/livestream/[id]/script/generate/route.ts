import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { generateScriptText } from '@/lib/googleFlow/flowJobs';
import { ChatApiError } from '@/lib/ai/chatClient';
import type { ChatStreamEvent } from '@/lib/ai/chatClient';
import { extractJson } from '@/lib/ai/jsonExtract';
import { buildLivestreamUserPrompt, resolveScriptSystemPrompt } from '@/lib/livestream/scriptPrompt';
import {
  computeSegmentDurations,
  findOverlongSegments,
  sanitizeSegments,
} from '@/lib/livestream/segmentSanitize';
import { shortenOverlongSegments } from '@/lib/livestream/shortenVoiceover';
import { recomputeSegmentOrder } from '@/lib/livestream/reorder';
import { describeProductAppearance } from '@/lib/livestream/productVision';
import { ensureStageBible, formatStageBibleBlock } from '@/lib/livestream/stageBible';
import { ensureLocalImage } from '@/lib/livestream/imageR2';
import { resolveWithinJob } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const body = (await req.json().catch(() => ({}))) as { productId?: string };

  const targets = body.productId
    ? job.products.filter((p) => p.id === body.productId)
    : job.products.filter(
        (p) => p.scriptStatus !== 'done' && p.ingestStatus !== 'needs_manual' && p.description.trim()
      );

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error: body.productId
          ? 'Sản phẩm không tồn tại hoặc không hợp lệ'
          : 'Không có sản phẩm nào sẵn sàng sinh script (kiểm tra đã điền mô tả/ingest xong chưa)',
      },
      { status: 400 }
    );
  }

  const stillGenerating = targets.flatMap((p) => p.segments.filter((s) => s.status === 'generating'));
  if (stillGenerating.length > 0) {
    return NextResponse.json(
      {
        error: `Không thể sinh script khi có đoạn đang generating: ${stillGenerating
          .map((s) => s.id)
          .join(', ')}. Vui lòng đợi hoặc dừng trước.`,
      },
      { status: 409 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Prompt override không đổi trong 1 lần chạy — resolve 1 lần từ job đã đọc ở đầu route.
      const systemPrompt = resolveScriptSystemPrompt(job);

      // Mô tả ngoại hình vật lý sản phẩm (đọc ảnh ref thật) — tính 1 lần cho cả job vì
      // selectedRefImagePaths dùng chung cho mọi sản phẩm. Best-effort: thiếu AI_VISION_MODEL,
      // chưa chọn ảnh ref, hay lỗi mạng đều bỏ qua, KHÔNG chặn sinh script như trước đây.
      let visualDescription: string | undefined;
      const refPath = job.selectedRefImagePaths[0];
      if (refPath) {
        try {
          await ensureLocalImage(job.id, refPath, job.imageR2Urls?.[refPath]);
          visualDescription = await describeProductAppearance(resolveWithinJob(job.id, refPath));
        } catch {
          // bỏ qua — script vẫn sinh bình thường không có mô tả ngoại hình bổ sung.
        }
      }

      // Sân khấu cố định cấp job (người dẫn/bối cảnh/góc máy/giọng) — chốt 1 lần rồi ép dùng lại
      // cho MỌI sản phẩm, nếu không mỗi lần gọi LLM (1 lần/sản phẩm) sẽ tự bịa 1 buổi live khác.
      // "Sinh script tất cả" (không có productId) = làm lại cả buổi live → chốt LẠI sân khấu theo ảnh
      // mẫu/background hiện tại; nếu không, bible cache từ lần trước (VD chốt người dẫn nữ khi chưa
      // có ảnh mẫu) được dùng lại mãi, sinh lại bao nhiêu lần cũng vẫn sai người. Còn sinh 1 sản
      // phẩm lẻ thì giữ bible cũ để khớp các sản phẩm đã gen trước đó.
      send({ type: 'stage_bible_start' });
      const bible = await ensureStageBible(id, { visualDescription, force: !body.productId });
      const stageBibleBlock = bible ? formatStageBibleBlock(bible) : undefined;
      send({ type: 'stage_bible_done', stageBible: bible });

      for (const product of targets) {
        send({ type: 'product_start', productId: product.id, name: product.name });
        await updateJob(id, (j) => {
          const p = j.products.find((x) => x.id === product.id);
          if (p) p.scriptStatus = 'generating';
        });

        try {
          const durations = computeSegmentDurations(product.targetDurationSec);
          // Vị trí tính trên TOÀN BỘ sản phẩm của job (không phải trong `targets`) — gen lại 1 sản
          // phẩm lẻ vẫn phải biết nó nằm giữa buổi live để viết câu chuyển tiếp, không chào lại.
          const index = job.products.findIndex((p) => p.id === product.id);
          const userPrompt = buildLivestreamUserPrompt(
            product.description,
            durations,
            visualDescription,
            stageBibleBlock,
            {
              index,
              total: job.products.length,
              prevProductName: index > 0 ? job.products[index - 1].name : undefined,
            }
          );

          const raw = await generateScriptText(systemPrompt, userPrompt, (e: ChatStreamEvent) => {
            if (e.type === 'start' || e.type === 'retry') {
              send({ ...e, productId: product.id });
            }
          });

          const parsed = JSON.parse(extractJson(raw)) as {
            segments?: Array<{ voiceoverVi?: string; veoPrompt?: string }>;
          };
          if (!Array.isArray(parsed.segments)) {
            throw new Error('AI không trả về danh sách đoạn hợp lệ');
          }
          const rawSegments = sanitizeSegments(parsed.segments, durations);
          // Lời thoại dài quá nhịp nói → Veo đọc không kịp, cắt cụt câu cuối. Ép AI viết lại NGAY
          // tại đây thay vì chỉ cảnh báo rồi bắt người dùng bấm sinh lại (lần sinh lại vẫn hay dư).
          const segments = await shortenOverlongSegments(rawSegments, (round, remaining) => {
            send({ type: 'shorten_start', productId: product.id, round, remaining });
          });

          const { result } = await updateJob(id, (j) => {
            const p = j.products.find((x) => x.id === product.id);
            if (!p) {
              return { conflict: true, message: 'Sản phẩm không tồn tại (có thể đã bị xoá)' };
            }
            const stillGen = p.segments.filter((s) => s.status === 'generating');
            if (stillGen.length > 0) {
              return {
                conflict: true,
                message: `Có đoạn đang generating giữa chừng: ${stillGen.map((s) => s.id).join(', ')}`,
              };
            }
            p.segments = segments;
            p.scriptStatus = 'done';
            p.scriptError = null;
            recomputeSegmentOrder(j);
            return { conflict: false, message: '' };
          });

          if (result.conflict) {
            send({ type: 'product_error', productId: product.id, message: result.message });
            continue;
          }

          // Phần còn sót sau khi đã tự rút gọn (AI lỗi / viết lại vẫn dư) — chỉ cảnh báo, không
          // chặn: video vẫn gen được, người dùng tự sửa tay hoặc bấm sinh lại.
          const overlong = findOverlongSegments(segments);
          send({ type: 'product_done', productId: product.id, segments, overlong });
        } catch (err) {
          const message =
            err instanceof ChatApiError
              ? `AI API lỗi: ${err.message}`
              : `Sinh script thất bại: ${(err as Error).message}`;
          await updateJob(id, (j) => {
            const p = j.products.find((x) => x.id === product.id);
            if (!p) return;
            p.scriptStatus = 'failed';
            p.scriptError = message;
          });
          send({ type: 'product_error', productId: product.id, message });
        }
      }

      send({ type: 'all_done' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
