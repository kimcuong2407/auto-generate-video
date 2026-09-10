/**
 * Self-check cho buildFlowRows() — bảng 6 bước luồng video review ở Bước 1.
 *
 * Vì sao cần: bảng này là nơi DUY NHẤT trong UI nói ra "ảnh nào thật sự đi vào bước nào".
 * Nếu nó nói sai — bảo là đang dùng khung khởi điểm (i2v) trong khi backend rơi về ref images
 * (r2v) — thì nó tệ hơn không có bảng: người dùng tin vào một điều không đúng và đi tìm nguyên
 * nhân video sai ở chỗ khác. Nên dòng 4 phải bám đúng planVideoInputs(), và các cột đếm phải
 * bám đúng điều kiện mà DownloadStep/ConcatStep dùng.
 *
 * Chạy: npx tsx scripts/check-project-guide.ts
 */
import assert from 'node:assert/strict';
import { buildFlowRows } from '../components/steps/ProjectGuide';
import type { Project, Scene, StoryboardImage } from '../lib/types';

function scene(over: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    label: '',
    duration: 8,
    camera: 'static',
    voiceoverVi: '',
    onScreenText: '',
    veoPrompt: '',
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

function storyboardImage(over: Partial<StoryboardImage> & { sceneId: string }): StoryboardImage {
  return {
    order: 1,
    prompt: '',
    imagePath: null,
    imageUrl: null,
    status: 'idle',
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
    ...over,
  } as StoryboardImage;
}

function project(over: {
  productImages?: string[];
  spokespersonImagePath?: string | null;
  productName?: string;
  visualDescription?: string;
  scenes?: Scene[];
  storyboardImages?: StoryboardImage[];
  useProductReference?: boolean;
  useSpokespersonReference?: boolean;
  sceneChaining?: boolean;
  videoRefImagePaths?: string[];
  scriptAngleId?: string | null;
  concatStatus?: string;
}): Project {
  return {
    scriptAngleId: over.scriptAngleId ?? null,
    sceneChaining: over.sceneChaining ?? true,
    videoRefImagePaths: over.videoRefImagePaths ?? [],
    product: {
      name: over.productName ?? '',
      tagline: '',
      category: '',
      colors: [],
      material: '',
      keyFeatures: [],
      visualDescription: over.visualDescription ?? '',
    },
    inputs: {
      productImages: over.productImages ?? [],
      productImageUrls: [],
      templatePath: '',
      backgroundPath: null,
      backgroundUrl: null,
      spokespersonImagePath: over.spokespersonImagePath ?? null,
      spokespersonImageUrl: null,
    },
    storyboard: {
      model: '',
      backgroundModel: '',
      useProductReference: over.useProductReference ?? false,
      productReferenceImagePath: null,
      useSpokespersonReference: over.useSpokespersonReference ?? false,
      images: over.storyboardImages ?? [],
      backgrounds: [],
    },
    script: { totalDuration: 48, aspectRatio: '9:16', scenes: over.scenes ?? [] },
    concat: { status: over.concatStatus ?? 'idle' },
  } as unknown as Project;
}

// 1. Project mới tinh (chưa có gì) → không ném lỗi, mọi bước đều chưa xong.
{
  const rows = buildFlowRows(project({}));
  assert.equal(rows.length, 6, 'phải đủ 6 bước');
  assert.ok(
    rows.every((r) => !r.ok),
    'project rỗng thì không bước nào được báo ✅'
  );
  assert.match(rows[3].images, /Chưa có cảnh nào/, 'chưa có scene thì dòng 4 phải nói rõ, không được crash');
}

// 2. Project hoàn tất mọi bước → mọi dòng ok.
{
  const s1 = scene({
    id: 'hook',
    order: 1,
    veoPrompt: 'x',
    status: 'done',
    videoPath: 'outputs/videos/hook.mp4',
  });
  const rows = buildFlowRows(
    project({
      productImages: ['inputs/p1.jpg'],
      productName: 'Handobox',
      scenes: [s1],
      storyboardImages: [
        storyboardImage({ sceneId: 'hook', status: 'done', imagePath: 'outputs/storyboard/hook.png' }),
      ],
      useProductReference: true,
      concatStatus: 'done',
    })
  );
  assert.ok(
    rows.every((r) => r.ok),
    `project hoàn tất phải ✅ hết, đang lỗi ở: ${rows.filter((r) => !r.ok).map((r) => r.step).join(', ')}`
  );
}

// 3. Dòng 4 phải bám planVideoInputs: có storyboard done → nói khung khởi điểm (i2v).
{
  const rows = buildFlowRows(
    project({
      scenes: [scene({ id: 'hook', order: 1, veoPrompt: 'x' })],
      storyboardImages: [
        storyboardImage({ sceneId: 'hook', status: 'done', imagePath: 'outputs/storyboard/hook.png' }),
      ],
      videoRefImagePaths: ['inputs/p1.jpg'],
    })
  );
  assert.match(rows[3].images, /Khung khởi điểm \(i2v\)/);
  assert.doesNotMatch(rows[3].images, /r2v/, 'có startImage thì Flow bỏ qua refImages — không được nói là r2v');
}

// 4. Không storyboard + có videoRefImagePaths → phải nói rơi về r2v, đúng số ảnh (trần 3).
{
  const rows = buildFlowRows(
    project({
      scenes: [scene({ id: 'hook', order: 1, veoPrompt: 'x' })],
      storyboardImages: [storyboardImage({ sceneId: 'hook', status: 'idle' })],
      videoRefImagePaths: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
    })
  );
  assert.match(rows[3].images, /r2v/, 'không có khung khởi điểm thì phải cảnh báo đang dùng r2v');
  assert.match(rows[3].images, /3 ảnh/, 'Flow chặn ở 3 ảnh — bảng phải nói đúng số thật được gửi');
}

// 5. Không có ảnh nào → cảnh báo gen thuần bằng chữ.
{
  const rows = buildFlowRows(
    project({ scenes: [scene({ id: 'hook', order: 1, veoPrompt: 'x' })] })
  );
  assert.match(rows[3].images, /CHƯA CÓ ẢNH NÀO/);
}

// 6. Dòng 3: toggle ref tắt hết → phải cảnh báo không gửi ảnh nào, không được im lặng.
{
  const rows = buildFlowRows(project({ spokespersonImagePath: 'inputs/person.jpg' }));
  assert.match(rows[2].images, /KHÔNG gửi ảnh nào/, 'toggle tắt là nguyên nhân storyboard sai màu — phải lộ ra');
}

// 7. Dòng 3: có ảnh người review nhưng toggle spokesperson tắt → không được kể ảnh đó vào.
{
  const rows = buildFlowRows(
    project({
      spokespersonImagePath: 'inputs/person.jpg',
      useProductReference: true,
      useSpokespersonReference: false,
    })
  );
  assert.match(rows[2].images, /1 ảnh sản phẩm/);
  assert.doesNotMatch(rows[2].images, /người review/, 'toggle tắt thì ảnh KHÔNG được gửi — bảng không được nói ngược');
}

// 8. Dòng 5 dùng đúng điều kiện của DownloadStep: done mà mất videoPath thì chưa sẵn sàng.
{
  const rows = buildFlowRows(
    project({
      scenes: [
        scene({ id: 'a', order: 1, veoPrompt: 'x', status: 'done', videoPath: 'outputs/videos/a.mp4' }),
        scene({ id: 'b', order: 2, veoPrompt: 'x', status: 'done', videoPath: null }),
      ],
    })
  );
  assert.match(rows[4].state, /1\/2 cảnh sẵn sàng tải/);
  assert.equal(rows[4].ok, false, 'thiếu file video thì không được báo bước 5 đã xong');
  assert.equal(rows[3].ok, true, 'nhưng bước 4 vẫn tính là done theo status');
}

console.log('✅ check-project-guide: 8/8 pass');
