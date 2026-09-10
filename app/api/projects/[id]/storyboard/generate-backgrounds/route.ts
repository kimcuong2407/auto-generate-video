import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerBackgroundGeneration } from '@/lib/data/backgroundGenerate';
import { runStoryboardBatch, type BatchEvent } from '@/lib/data/storyboardBatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gen TẤT CẢ ảnh background — tuần tự từng ảnh, retry tối đa STORYBOARD_MAX_ATTEMPTS lần mỗi ảnh,
 * trả tiến độ realtime qua SSE.
 *
 * Vì sao SSE chứ không phải JSON một cục như trước: loạt 8 ảnh chạy vài phút mà route chỉ trả lời
 * ở cuối, nên UI không có cách nào biết đang ở ảnh nào — chỉ hiện "Đang gen tất cả..." suốt. Phía
 * client vẫn có polling project 2s làm lưới an toàn, nhưng SSE cho biết thêm thứ project.json
 * KHÔNG lưu: đang thử lần mấy, còn chờ bao lâu trước khi thử lại.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  const targets = project.storyboard.backgrounds
    .filter((img) => (img.status === 'idle' || img.status === 'failed') && img.prompt.trim())
    .map((img) => ({ sceneId: img.sceneId }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BatchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runStoryboardBatch(targets, (sceneId) => triggerBackgroundGeneration(id, sceneId), send);
      } catch (err) {
        // Lỗi ngoài dự kiến của chính vòng lặp (không phải lỗi 1 ảnh — cái đó đã thành image-done
        // ok:false). Báo ra để client khỏi treo chờ event 'done' không bao giờ tới.
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'fatal', message: (err as Error).message })}\n\n`)
        );
      } finally {
        controller.close();
      }
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
