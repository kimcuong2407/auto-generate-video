import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConcatMeta, Project } from '../types';
import { projectOutputsDir, projectTmpDir, resolveWithinProject } from '../paths';
import { run } from './run';

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * Overlay text lên 1 scene, giữ nguyên audio gốc của video Veo (đã chứa
 * voiceover sẵn — không còn file voiceover .mp3 riêng như bản mẫu cũ).
 */
async function overlaySceneText(
  videoPath: string,
  text: string,
  outPath: string
): Promise<void> {
  const textEscaped = escapeDrawtext(text);
  await run('ffmpeg', [
    '-i',
    videoPath,
    '-vf',
    `drawtext=text='${textEscaped}':fontcolor=white:fontsize=36:box=1:boxcolor=black@0.5:boxborderw=6:x=(w-text_w)/2:y=h-text_h-40`,
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    outPath,
    '-y',
  ]);
}

function aspectDimensions(aspectRatio: '9:16' | '16:9'): { width: number; height: number } {
  return aspectRatio === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

export async function runConcatPipeline(
  project: Project,
  onLog: (line: string) => Promise<void>
): Promise<{ outputPath: string; outputMeta: ConcatMeta }> {
  const tmpDir = projectTmpDir(project.id);
  const outputsDir = projectOutputsDir(project.id);
  await fs.mkdir(tmpDir, { recursive: true });

  const orderedScenes = [...project.script.scenes].sort((a, b) => a.order - b.order);
  const skippedScenes = orderedScenes.filter((s) => s.status !== 'done' || !s.videoPath);
  const availableScenes = orderedScenes.filter((s) => s.status === 'done' && s.videoPath);

  if (availableScenes.length === 0) {
    throw new Error('Chưa có cảnh nào gen xong để ghép');
  }
  if (skippedScenes.length > 0) {
    await onLog(
      `⚠️ Bỏ qua ${skippedScenes.length} cảnh chưa gen xong: ${skippedScenes.map((s) => s.id).join(', ')} — vẫn ghép ${availableScenes.length} cảnh còn lại theo đúng thứ tự.`
    );
  }

  const processedPaths: string[] = [];

  for (const scene of availableScenes) {
    // scene.videoPath lưu dạng tương đối trong project, VD "outputs/scenes/01_intro.mp4"
    const videoAbsPath = resolveWithinProject(project.id, scene.videoPath as string);
    if (project.burnOnScreenText && scene.onScreenText.trim()) {
      const outPath = path.join(tmpDir, `${scene.order.toString().padStart(2, '0')}_${scene.id}_processed.mp4`);
      await overlaySceneText(videoAbsPath, scene.onScreenText, outPath);
      processedPaths.push(outPath);
      await onLog(`✓ ${scene.id}.mp4 → text overlay done (audio gốc giữ nguyên)`);
    } else {
      processedPaths.push(videoAbsPath);
      await onLog(`✓ ${scene.id}.mp4 → giữ nguyên (không overlay text)`);
    }
  }

  const concatListPath = path.join(tmpDir, 'concat_list.txt');
  const concatListContent = processedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(concatListPath, concatListContent, 'utf-8');
  await onLog(`✓ Concatenating ${processedPaths.length} scenes...`);

  const outputPath = path.join(outputsDir, 'final.mp4');
  const { width, height } = aspectDimensions(project.aspectRatio);
  // project.music.path lưu dạng tương đối trong project, VD "outputs/music/bg.mp3"
  const musicPath = project.music.path ? resolveWithinProject(project.id, project.music.path) : null;

  const hasMusic = musicPath ? await fs.access(musicPath).then(() => true).catch(() => false) : false;
  // Tổng thời lượng thực tế của các cảnh THỰC SỰ được ghép (có thể ít hơn totalDuration
  // của toàn bộ kịch bản nếu bỏ qua cảnh chưa gen xong) — dùng để tính đúng thời điểm fade nhạc.
  const availableDuration = availableScenes.reduce((sum, s) => sum + s.duration, 0);

  if (hasMusic && musicPath) {
    await onLog(`✓ Mixing background music (vol ${Math.round(project.music.volume * 100)}%)`);
    await run('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-i', musicPath,
      '-filter_complex',
      `[1:a]volume=${project.music.volume},afade=t=out:d=${project.music.fadeOutDuration}:start_time=${Math.max(0, availableDuration - project.music.fadeOutDuration)}[bg];` +
        `[0:a]volume=1.0[vox];` +
        `[vox][bg]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-vf', `scale=${width}:${height}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-movflags', '+faststart',
      outputPath, '-y',
    ]);
  } else {
    await run('ffmpeg', [
      '-f', 'concat', '-safe', '0', '-i', concatListPath,
      '-vf', `scale=${width}:${height}`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k',
      '-pix_fmt', 'yuv420p', '-r', '30',
      '-movflags', '+faststart',
      outputPath, '-y',
    ]);
  }

  const stat = await fs.stat(outputPath);
  const probe = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    outputPath,
  ]);
  const probeData = JSON.parse(probe.stdout) as {
    streams?: Array<{ width: number; height: number; r_frame_rate: string }>;
    format?: { duration: string };
  };
  const stream = probeData.streams?.[0];
  const fpsRaw = stream?.r_frame_rate ?? '30/1';
  const [num, den] = fpsRaw.split('/').map(Number);
  const fps = den ? Math.round(num / den) : Math.round(num);

  const outputMeta: ConcatMeta = {
    sizeBytes: stat.size,
    durationSec: Number(probeData.format?.duration ?? project.script.totalDuration),
    width: stream?.width ?? width,
    height: stream?.height ?? height,
    fps,
  };

  await onLog(`🎉 Final video: ${outputPath}`);
  return { outputPath, outputMeta };
}
