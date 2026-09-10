import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject } from '@/lib/data/projectStore';
import { triggerStoryboardGeneration } from '@/lib/data/storyboardGenerate';
import { runStoryboardBatch, type BatchEvent } from '@/lib/data/storyboardBatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Gen TẤT CẢ ảnh storyboard — tuần tự + retry + SSE. Xem doc-comment của route
 * generate-backgrounds: cùng cơ chế, chỉ khác mảng nguồn và hàm trigger.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);
  const targets = project.storyboard.images
    .filter((img) => (img.status === 'idle' || img.status === 'failed') && img.prompt.trim())
    .map((img) => ({ sceneId: img.sceneId }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BatchEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await runStoryboardBatch(targets, (sceneId) => triggerStoryboardGeneration(id, sceneId), send);
      } catch (err) {
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
