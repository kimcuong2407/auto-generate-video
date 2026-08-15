import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { generateScriptText } from '@/lib/googleFlow/flowJobs';
import { ChatApiError } from '@/lib/ai/chatClient';
import type { ChatStreamEvent } from '@/lib/ai/chatClient';
import { extractJson } from '@/lib/ai/jsonExtract';
import { buildLivestreamUserPrompt, resolveScriptSystemPrompt } from '@/lib/livestream/scriptPrompt';
import { computeSegmentDurations, sanitizeSegments } from '@/lib/livestream/segmentSanitize';
import { recomputeSegmentOrder } from '@/lib/livestream/reorder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
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

      for (const product of targets) {
        send({ type: 'product_start', productId: product.id, name: product.name });
        await updateJob(id, (j) => {
          const p = j.products.find((x) => x.id === product.id);
          if (p) p.scriptStatus = 'generating';
        });

        try {
          const durations = computeSegmentDurations(product.targetDurationSec);
          const userPrompt = buildLivestreamUserPrompt(product.description, durations);

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
          const segments = sanitizeSegments(parsed.segments, durations);

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

          send({ type: 'product_done', productId: product.id, segments });
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
