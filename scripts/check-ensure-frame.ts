/**
 * Self-check cho ensureLastFrame: frame còn → no-op; frame mất + có video local → extract lại;
 * mất cả hai + không có URL → false (caller bỏ chain).
 * Chạy: npx tsx scripts/check-ensure-frame.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../lib/ffmpeg/run';
import { ensureLastFrame } from '../lib/ffmpeg/ensureFrame';

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ensure-frame-'));
  const videoPath = path.join(dir, 'clip.mp4');
  const framePath = path.join(dir, 'frames', 'last.jpg');

  await run('ffmpeg', ['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10:duration=5', '-pix_fmt', 'yuv420p', videoPath, '-y']);

  // 1. frame mất, video local còn → extract lại (mkdir cả thư mục frames)
  assert.equal(await ensureLastFrame(framePath, videoPath, null), true);
  assert.ok((await fs.stat(framePath)).size > 0);

  // 2. frame đã có → no-op, giữ nguyên nội dung
  await fs.writeFile(framePath, 'sentinel');
  assert.equal(await ensureLastFrame(framePath, videoPath, null), true);
  assert.equal(await fs.readFile(framePath, 'utf8'), 'sentinel');

  // 3. mất cả frame lẫn video, không có URL → false
  await fs.rm(framePath);
  assert.equal(await ensureLastFrame(framePath, path.join(dir, 'missing.mp4'), null), false);

  await fs.rm(dir, { recursive: true, force: true });
  console.log('✅ ensureLastFrame OK');
}

main();
