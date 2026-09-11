/**
 * Self-check: luật tự phục hồi của gen video product-review, port từ livestream (2026-09-11).
 *
 * Vì sao cần: trước đây một cảnh hỏng vì lỗi TẠM THỜI (mint reCAPTCHA timeout, Flow 5xx) làm
 * đứt dây chuyền vĩnh viễn — người dùng bấm gen cả loạt mà chỉ chạy tới cảnh hỏng rồi nằm im.
 * Các ranh giới dưới đây là thứ giữ cho nó vừa tự phục hồi được, vừa không quay vòng vô hạn
 * đốt quota Veo.
 *
 * Chạy: npx tsx scripts/check-scene-autoretry.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldAutoTrigger } from '../lib/data/sceneSync';
import { planVideoInputs, MAX_REF_IMAGES } from '../lib/data/videoInputs';
import { MAX_SEGMENT_AUTO_RETRIES, SEGMENT_RETRY_BACKOFF_MS } from '../lib/constants';
import type { Project, Scene } from '../lib/types';

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString();

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 'sc-1',
    order: 1,
    label: '',
    duration: 8,
    camera: '',
    voiceoverVi: '',
    onScreenText: '',
    veoPrompt: 'một cảnh hợp lệ',
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

// ---------------------------------------------------------------
// 1. shouldAutoTrigger — trần attempts + backoff thời gian.
// ---------------------------------------------------------------
assert.equal(shouldAutoTrigger(scene(), NOW), true, 'idle + có prompt → chạy');
assert.equal(
  shouldAutoTrigger(scene({ veoPrompt: '   ' }), NOW),
  false,
  'chưa có veoPrompt thì KHÔNG được tự gen — sẽ fail ngay và đốt attempts vô ích'
);
assert.equal(shouldAutoTrigger(scene({ status: 'generating' }), NOW), false, 'đang chạy → không đụng');
assert.equal(shouldAutoTrigger(scene({ status: 'done' }), NOW), false, 'đã xong → không gen lại');

// failed: phụ thuộc attempts + backoff.
const failedFresh = scene({ status: 'failed', attempts: 1, lastUpdatedAt: isoAgo(1000) });
assert.equal(
  shouldAutoTrigger(failedFresh, NOW),
  false,
  'vừa fail xong phải CHỜ hết backoff — poller chạy 15s/lần, thử lại ngay là đập API 240 lần/giờ'
);
assert.equal(
  shouldAutoTrigger({ ...failedFresh, lastUpdatedAt: isoAgo(SEGMENT_RETRY_BACKOFF_MS + 1000) }, NOW),
  true,
  'qua backoff thì được thử lại'
);
assert.equal(
  shouldAutoTrigger(
    scene({
      status: 'failed',
      attempts: MAX_SEGMENT_AUTO_RETRIES,
      lastUpdatedAt: isoAgo(SEGMENT_RETRY_BACKOFF_MS * 10),
    }),
    NOW
  ),
  false,
  'chạm trần attempts → dừng hẳn, dù đã qua backoff bao lâu (lỗi THẬT không được quay vòng vô hạn)'
);

// ---------------------------------------------------------------
// 2. planVideoInputs — frame nối đi VÀO refImages khi có ref (luật livestream).
// ---------------------------------------------------------------
function project(over: Partial<Project> = {}): Project {
  return {
    sceneChaining: true,
    videoRefImagePaths: [],
    storyboard: { images: [], backgrounds: [] },
    script: { scenes: [] },
    ...over,
  } as unknown as Project;
}

const prevDone = scene({
  id: 'sc-1',
  order: 1,
  status: 'done',
  lastFramePath: 'outputs/frames/01_sc-1_last.jpg',
});
const cur = scene({ id: 'sc-2', order: 2 });

// 2a. Có frame chain + có ref người dùng chọn → GỘP, frame đứng đầu.
{
  const p = project({
    videoRefImagePaths: ['a.jpg', 'b.jpg'],
    script: { scenes: [prevDone, cur] } as Project['script'],
  });
  const plan = planVideoInputs(p, cur);
  assert.equal(plan.startRelPath, null, 'đã dùng r2v thì startRelPath phải rỗng — generateVideo âm thầm bỏ qua startImage khi refImages không rỗng');
  assert.deepEqual(
    plan.refRelPaths,
    ['outputs/frames/01_sc-1_last.jpg', 'a.jpg', 'b.jpg'],
    'frame phải đứng ĐẦU refImages (ảnh đầu có trọng số dẫn dắt lớn nhất)'
  );
  assert.equal(plan.chained, true);
  assert.equal(plan.chainFrameRelPath, 'outputs/frames/01_sc-1_last.jpg', 'caller cần biết frame nào để ensureLastFrame');
  assert.ok(plan.refRelPaths.length <= MAX_REF_IMAGES, 'không vượt trần 3 ảnh của Veo');
}

// 2b. Trần 3 ảnh: frame chiếm 1 suất, ref bị cắt còn 2.
{
  const p = project({
    videoRefImagePaths: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
    script: { scenes: [prevDone, cur] } as Project['script'],
  });
  const plan = planVideoInputs(p, cur);
  assert.equal(plan.refRelPaths.length, MAX_REF_IMAGES, 'đúng trần 3');
  assert.deepEqual(plan.refRelPaths, ['outputs/frames/01_sc-1_last.jpg', 'a.jpg', 'b.jpg']);
}

// 2c. Có frame chain nhưng KHÔNG ref nào → frame làm startImage (i2v thuần) như cũ.
{
  const p = project({ script: { scenes: [prevDone, cur] } as Project['script'] });
  const plan = planVideoInputs(p, cur);
  assert.equal(plan.startRelPath, 'outputs/frames/01_sc-1_last.jpg');
  assert.deepEqual(plan.refRelPaths, []);
  assert.equal(plan.chained, true);
}

// 2d. Không chain → ảnh storyboard làm startImage, ref rỗng.
{
  const p = project({
    sceneChaining: false,
    videoRefImagePaths: ['a.jpg'],
    storyboard: {
      images: [{ sceneId: 'sc-2', status: 'done', imagePath: 'sb.jpg' }],
      backgrounds: [],
    } as unknown as Project['storyboard'],
    script: { scenes: [prevDone, cur] } as Project['script'],
  });
  const plan = planVideoInputs(p, cur);
  assert.equal(plan.startRelPath, 'sb.jpg');
  assert.deepEqual(plan.refRelPaths, [], 'có startImage thì ref PHẢI rỗng');
  assert.equal(plan.chainFrameRelPath, null);
}

// 2e. Không gì cả → r2v với ảnh Bước 4.
{
  const p = project({
    sceneChaining: false,
    videoRefImagePaths: ['a.jpg', 'b.jpg'],
    script: { scenes: [cur] } as Project['script'],
  });
  const plan = planVideoInputs(p, cur);
  assert.equal(plan.startRelPath, null);
  assert.deepEqual(plan.refRelPaths, ['a.jpg', 'b.jpg']);
}

// ---------------------------------------------------------------
// 3. Quota KHÔNG được đốt attempts — nếu không, 3 lần gặp quota là cảnh hết cửa retry vĩnh viễn.
// ---------------------------------------------------------------
{
  const src = readFileSync(new URL('../lib/data/sceneGenerate.ts', import.meta.url), 'utf8');
  assert.ok(/isQuotaError/.test(src), 'sceneGenerate phải nhận diện lỗi quota');
  assert.ok(
    /if \(!quota\) s\.attempts \+= 1;/.test(src),
    'nhánh catch chỉ được tăng attempts khi KHÔNG phải lỗi quota'
  );
  assert.ok(/quotaExceeded: quota/.test(src), 'phải trả cờ quotaExceeded cho caller dừng cascade');
}

// ---------------------------------------------------------------
// 4. Poller phải ngó cả project KHÔNG còn cảnh generating — nếu không resumeStalledProject
//    không bao giờ chạy và dây chuyền đứt nằm chết vĩnh viễn.
// ---------------------------------------------------------------
{
  const src = readFileSync(new URL('../lib/data/backgroundPoller.ts', import.meta.url), 'utf8');
  assert.ok(/projectNeedsAttention/.test(src), 'phải có projectNeedsAttention thay cho lọc hasGeneratingScene trần');
  assert.ok(/resumeStalledProject/.test(src), 'poller phải gọi resumeStalledProject mỗi vòng');
  assert.ok(
    /attempts > 0/.test(src),
    'chỉ nối tiếp project người dùng ĐÃ bấm gen — thiếu điều kiện này poller tự khởi động mọi project nháp, đốt quota'
  );
}

console.log('check-scene-autoretry: OK');
