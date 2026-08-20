import { NextRequest, NextResponse } from 'next/server';
import { mergeExists, readMerge, updateMerge, idleConcatState } from '@/lib/livestream/mergeStore';
import { runMergeConcat } from '@/lib/livestream/mergeConcat';
import { uploadFileToR2 } from '@/lib/r2/client';
import { resolveWithinMerge } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await mergeExists(id))) {
    return NextResponse.json({ error: 'Merge không tồn tại' }, { status: 404 });
  }
  const merge = await readMerge(id);
  if (merge.concat.status === 'running') {
    return NextResponse.json({ error: 'Đang ghép, vui lòng chờ' }, { status: 409 });
  }

  await updateMerge(id, (m) => {
    m.concat = { ...idleConcatState(), status: 'running', startedAt: new Date().toISOString() };
  });

  // Fire-and-forget: chạy ffmpeg trong background, không chặn response HTTP.
  runMergeConcatInBackground(id).catch(() => {
    // lỗi đã được xử lý và ghi vào merge.concat bên trong runMergeConcatInBackground
  });

  return NextResponse.json({ ok: true, started: true });
}

async function runMergeConcatInBackground(id: string): Promise<void> {
  const merge = await readMerge(id);

  const appendLog = async (line: string) => {
    await updateMerge(id, (m) => {
      m.concat.log.push(line);
    });
  };

  try {
    const { outputMeta } = await runMergeConcat(id, merge.jobSlugs, appendLog);

    const finalAbsPath = resolveWithinMerge(id, 'outputs/final.mp4');
    const outputUrl = await uploadFileToR2(finalAbsPath, `livestream/_merges/${id}/final.mp4`, 'video/mp4');
    if (outputUrl) {
      await appendLog(`☁️ Đã upload final lên R2: ${outputUrl}`);
    }

    await updateMerge(id, (m) => {
      m.concat.status = 'done';
      m.concat.outputPath = 'outputs/final.mp4';
      m.concat.outputUrl = outputUrl;
      m.concat.outputMeta = outputMeta;
      m.concat.finishedAt = new Date().toISOString();
    });
  } catch (err) {
    const message = (err as Error).message;
    await updateMerge(id, (m) => {
      m.concat.status = 'failed';
      m.concat.error = message.slice(-500);
      m.concat.finishedAt = new Date().toISOString();
      m.concat.log.push(`✗ Lỗi: ${message.slice(-500)}`);
    });
  }
}
