import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { resolveWithinProject } from '@/lib/paths';
import { runConcatPipeline } from '@/lib/ffmpeg/concat';
import { uploadFileToR2 } from '@/lib/r2/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!projectExists(params.id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }
  const project = await readProject(params.id);
  return NextResponse.json({ concat: project.concat });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(id);

  if (project.concat.status === 'running') {
    return NextResponse.json({ error: 'Đang ghép video, vui lòng chờ' }, { status: 409 });
  }

  // Cho phép ghép ngay cả khi còn scene chưa gen xong — chỉ bỏ qua các scene đó,
  // vẫn ghép các scene đã có video theo đúng thứ tự (xử lý thật trong runConcatPipeline).
  // Chỉ chặn khi KHÔNG có scene nào sẵn sàng để ghép.
  const missing: string[] = [];
  let hasAnyReady = false;
  for (const scene of project.script.scenes) {
    if (scene.status !== 'done' || !scene.videoPath) {
      missing.push(scene.id);
      continue;
    }
    try {
      await fs.access(resolveWithinProject(id, scene.videoPath));
      hasAnyReady = true;
    } catch {
      missing.push(scene.id);
    }
  }
  if (!hasAnyReady) {
    return NextResponse.json({ error: 'missing_scenes', scenes: missing }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    musicVolume?: number;
    fadeOutDuration?: number;
  };

  await updateProject(id, (p) => {
    if (body.musicVolume !== undefined) p.music.volume = body.musicVolume;
    if (body.fadeOutDuration !== undefined) p.music.fadeOutDuration = body.fadeOutDuration;
    p.concat = {
      status: 'running',
      log: [],
      outputPath: null,
      outputUrl: null,
      outputMeta: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
  });

  // Fire-and-forget: chạy ffmpeg trong background, không chặn response HTTP
  runConcatInBackground(id).catch(() => {
    // lỗi đã được xử lý và ghi vào project.json bên trong runConcatInBackground
  });

  return NextResponse.json({ ok: true, started: true });
}

async function runConcatInBackground(id: string): Promise<void> {
  const project = await readProject(id);

  const appendLog = async (line: string) => {
    await updateProject(id, (p) => {
      p.concat.log.push(line);
    });
  };

  try {
    const { outputMeta } = await runConcatPipeline(project, appendLog);
    const outputAbsPath = resolveWithinProject(id, 'outputs/final.mp4');
    const outputUrl = await uploadFileToR2(outputAbsPath, `projects/${id}/final.mp4`, 'video/mp4');
    await updateProject(id, (p) => {
      p.concat.status = 'done';
      p.concat.outputPath = 'outputs/final.mp4';
      p.concat.outputUrl = outputUrl;
      p.concat.outputMeta = outputMeta;
      p.concat.finishedAt = new Date().toISOString();
    });
    if (outputUrl) {
      // File local không còn cần thiết sau khi đã có bản trên R2 (không ai đọc lại
      // outputs/final.mp4 nữa) — xoá SAU KHI project.json đã ghi xong outputUrl, để không
      // mất dữ liệu nếu process crash giữa chừng.
      await fs.unlink(outputAbsPath).catch(() => {});
    } else {
      await appendLog('⚠️ Upload R2 thất bại — giữ final.mp4 trên VPS, dùng link tải local.');
    }
  } catch (err) {
    const message = (err as Error).message;
    await updateProject(id, (p) => {
      p.concat.status = 'failed';
      p.concat.error = message.slice(-500);
      p.concat.finishedAt = new Date().toISOString();
      p.concat.log.push(`✗ Lỗi: ${message.slice(-500)}`);
    });
  }
}
