/**
 * Self-check cho planVideoInputs() — logic chọn ảnh đầu vào khi gen video scene.
 *
 * Vì sao cần: đây là nhánh quyết định video có bám đúng sản phẩm thật hay không.
 * Sai một nhánh (gửi kèm refImages khi đã có startImage) là Google Flow lặng lẽ rơi
 * về endpoint r2v và BỎ QUA khung hình khởi điểm — video ra khác hẳn sản phẩm mà
 * không có lỗi nào được ném ra.
 *
 * Chạy: npx tsx scripts/check-video-inputs.ts
 */
import assert from 'node:assert/strict';
import { planVideoInputs } from '../lib/data/sceneGenerate';
import type { Project, Scene } from '../lib/types';

function scene(over: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    label: '',
    duration: 8,
    camera: 'static',
    type: null,
    voiceoverVi: '',
    onScreenText: '',
    veoPrompt: 'x',
    negativePrompt: '',
    status: 'idle',
    jobId: null,
    videoPath: null,
    videoUrl: null,
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
    lastFramePath: null,
    chainedFromPrevious: false,
    ...over,
  } as Scene;
}

function project(over: {
  scenes: Scene[];
  storyboardImages?: Array<{ sceneId: string; status: string; imagePath: string | null }>;
  sceneChaining?: boolean;
  videoRefImagePaths?: string[];
}): Project {
  return {
    sceneChaining: over.sceneChaining ?? true,
    videoRefImagePaths: over.videoRefImagePaths ?? [],
    script: { scenes: over.scenes },
    storyboard: { images: over.storyboardImages ?? [], backgrounds: [] },
  } as unknown as Project;
}

// 1. Cảnh đầu, có storyboard done → dùng storyboard làm khung khởi điểm, KHÔNG kèm refImages.
{
  const s1 = scene({ id: 'hook', order: 1 });
  const p = project({
    scenes: [s1],
    storyboardImages: [{ sceneId: 'hook', status: 'done', imagePath: 'outputs/storyboard/hook.png' }],
    videoRefImagePaths: ['inputs/product-2.jpg'],
  });
  const plan = planVideoInputs(p, s1);
  assert.equal(plan.startRelPath, 'outputs/storyboard/hook.png');
  assert.deepEqual(plan.refRelPaths, [], 'có startImage thì refImages phải rỗng, nếu không Flow bỏ qua startImage');
  assert.equal(plan.chained, false, 'cảnh đầu không phải chain');
}

// 2. Cảnh 2, chain bật + cảnh trước done có frame → frame cảnh trước THẮNG storyboard.
{
  const s1 = scene({ id: 'hook', order: 1, status: 'done', lastFramePath: 'outputs/frames/01_last.jpg' });
  const s2 = scene({ id: 'detail', order: 2 });
  const p = project({
    scenes: [s1, s2],
    storyboardImages: [{ sceneId: 'detail', status: 'done', imagePath: 'outputs/storyboard/detail.png' }],
  });
  const plan = planVideoInputs(p, s2);
  assert.equal(plan.startRelPath, 'outputs/frames/01_last.jpg');
  assert.deepEqual(plan.refRelPaths, []);
  assert.equal(plan.chained, true);
}

// 3. Chain TẮT → không dùng frame cảnh trước, rơi về storyboard, cờ chained phải false.
{
  const s1 = scene({ id: 'hook', order: 1, status: 'done', lastFramePath: 'outputs/frames/01_last.jpg' });
  const s2 = scene({ id: 'detail', order: 2 });
  const p = project({
    scenes: [s1, s2],
    sceneChaining: false,
    storyboardImages: [{ sceneId: 'detail', status: 'done', imagePath: 'outputs/storyboard/detail.png' }],
  });
  const plan = planVideoInputs(p, s2);
  assert.equal(plan.startRelPath, 'outputs/storyboard/detail.png');
  assert.equal(plan.chained, false);
}

// 4. Cảnh trước CHƯA done → không được chain (frame chưa tồn tại), rơi về storyboard.
{
  const s1 = scene({ id: 'hook', order: 1, status: 'failed', lastFramePath: 'outputs/frames/01_last.jpg' });
  const s2 = scene({ id: 'detail', order: 2 });
  const p = project({
    scenes: [s1, s2],
    storyboardImages: [{ sceneId: 'detail', status: 'done', imagePath: 'outputs/storyboard/detail.png' }],
  });
  const plan = planVideoInputs(p, s2);
  assert.equal(plan.startRelPath, 'outputs/storyboard/detail.png');
  assert.equal(plan.chained, false);
}

// 5. Storyboard chưa gen xong + không chain → rơi về r2v, cắt tối đa 3 ảnh (giới hạn Flow).
{
  const s1 = scene({ id: 'hook', order: 1 });
  const p = project({
    scenes: [s1],
    storyboardImages: [{ sceneId: 'hook', status: 'idle', imagePath: null }],
    videoRefImagePaths: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
  });
  const plan = planVideoInputs(p, s1);
  assert.equal(plan.startRelPath, null);
  assert.deepEqual(plan.refRelPaths, ['a.jpg', 'b.jpg', 'c.jpg'], 'vượt 3 ảnh → Flow trả INVALID_ARGUMENT');
  assert.equal(plan.chained, false);
}

// 6. Không có gì cả → t2v thuần, không ném lỗi.
{
  const s1 = scene({ id: 'hook', order: 1 });
  const plan = planVideoInputs(project({ scenes: [s1] }), s1);
  assert.equal(plan.startRelPath, null);
  assert.deepEqual(plan.refRelPaths, []);
}

console.log('OK — planVideoInputs: 6/6 checks passed');
