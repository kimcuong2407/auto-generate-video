import type { Project, ProductInfo, Scene, StoryboardImage, Template, TemplateScene } from '../types';
import { DEFAULT_STORYBOARD_MODEL } from '../constants';

const DEFAULT_VEO_MODEL: Project['veoModel'] = 'veo_3_1_lite';

export const DEFAULT_NEGATIVE_PROMPT =
  'text overlay, watermarks, logo, blurry, low quality, distorted faces, messy background, ' +
  'extra limbs, extra arms, extra hands, extra fingers, three hands, three arms, four arms, ' +
  'deformed hands, deformed fingers, fused fingers, disfigured hands, missing fingers, ' +
  'multiple limbs, merged limbs, duplicated body parts, artificial looking, plastic skin, ' +
  'overly smooth, glossy AI-rendered look, uncanny valley, perfect symmetry, flawless surfaces, ' +
  'CGI look, video game render, waxy skin texture, over-sharpened, oversaturated colors, ' +
  'unnatural lighting, jump cuts, inconsistent lighting between shots';

export interface SceneFields {
  id: string;
  label: string;
  duration: number;
  camera: string;
  type?: string;
  voiceoverVi?: string;
  onScreenText?: string;
  veoPrompt?: string;
  negativePrompt?: string;
}

/** Dựng 1 Scene đầy đủ (trạng thái runtime mặc định) từ các field nội dung — dùng chung cho
 * scaffold từ template ở Bước 1, sinh nháp AI, và thêm cảnh thủ công ở Bước 2. */
export function buildSceneFromFields(fields: SceneFields, order: number): Scene {
  return {
    id: fields.id,
    order,
    label: fields.label,
    duration: fields.duration,
    camera: fields.camera,
    type: fields.type,
    voiceoverVi: fields.voiceoverVi ?? '',
    onScreenText: fields.onScreenText ?? '',
    veoPrompt: fields.veoPrompt ?? '',
    negativePrompt: fields.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
    status: 'idle',
    jobId: null,
    videoPath: null,
    videoUrl: null,
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
    lastFramePath: null,
    chainedFromPrevious: false,
  };
}

function buildEmptyScene(s: TemplateScene, order: number): Scene {
  return buildSceneFromFields(
    { id: s.id, label: s.label, duration: s.duration, camera: s.camera, type: s.type },
    order
  );
}

function buildScenesFromTemplate(template: Template): Scene[] {
  return template.scenes.map((s, index) => buildEmptyScene(s, index + 1));
}

export interface MergeScenesResult {
  scenes: Scene[];
  /** id của các scene bị loại khỏi template mới mà đã có dữ liệu quan trọng (video/đang gen). */
  removedWithData: string[];
}

/**
 * Merge scene hiện có với template mới theo scene id:
 * - id trùng: giữ nguyên nội dung đã có (voiceover/prompt/status/video...),
 *   chỉ cập nhật label/duration/camera/order theo template mới.
 * - id mới: tạo scene rỗng.
 * - id bị loại khỏi template mới: loại khỏi kết quả; nếu scene đó đã có
 *   videoPath hoặc đang generating, ghi nhận vào removedWithData để route
 *   gọi hàm này có thể cảnh báo trước khi lưu đè.
 */
export function mergeScenesWithTemplate(
  existingScenes: Scene[],
  newTemplate: Template
): MergeScenesResult {
  const existingById = new Map(existingScenes.map((s) => [s.id, s]));
  const newIds = new Set(newTemplate.scenes.map((s) => s.id));

  const scenes = newTemplate.scenes.map((templateScene, index) => {
    const existing = existingById.get(templateScene.id);
    if (!existing) {
      return buildEmptyScene(templateScene, index + 1);
    }
    return {
      ...existing,
      order: index + 1,
      label: templateScene.label,
      duration: templateScene.duration,
      camera: templateScene.camera,
    };
  });

  const removedWithData = existingScenes
    .filter((s) => !newIds.has(s.id) && (s.videoPath || s.status === 'generating'))
    .map((s) => s.id);

  return { scenes, removedWithData };
}

/** Gợi ý prompt ảnh storyboard (tiếng Anh, ngắn) từ các field mô tả sẵn có trong template scene. */
function seedStoryboardPrompt(s: TemplateScene): string {
  const parts = [s.label, s.focus, s.lighting, s.color_palette].filter(Boolean);
  return parts.join(', ');
}

function buildEmptyStoryboardImage(s: TemplateScene, order: number): StoryboardImage {
  return {
    sceneId: s.id,
    order,
    prompt: seedStoryboardPrompt(s),
    imagePath: null,
    status: 'idle',
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
  };
}

export function buildStoryboardFromTemplate(template: Template): StoryboardImage[] {
  return template.scenes.map((s, index) => buildEmptyStoryboardImage(s, index + 1));
}

/** Ảnh background khởi tạo rỗng — prompt để trống (không seed từ label/focus như storyboard, vì
 * ảnh background không được phép mô tả sản phẩm) — người dùng tự viết hoặc bấm "Sinh prompt AI". */
function buildEmptyBackgroundImage(s: TemplateScene, order: number): StoryboardImage {
  return {
    sceneId: s.id,
    order,
    prompt: '',
    imagePath: null,
    status: 'idle',
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
  };
}

export function buildBackgroundsFromTemplate(template: Template): StoryboardImage[] {
  return template.scenes.map((s, index) => buildEmptyBackgroundImage(s, index + 1));
}

export interface MergeStoryboardResult {
  images: StoryboardImage[];
  /** sceneId của các ảnh bị loại khỏi template mới mà đã gen xong. */
  removedWithData: string[];
}

/**
 * Merge danh sách ảnh storyboard hiện có với template mới theo sceneId — cùng cách
 * mergeScenesWithTemplate xử lý Scene, để tránh mất ảnh đã gen khi chỉ đổi
 * label/duration/camera của scene mà id không đổi.
 */
export function mergeStoryboardWithTemplate(
  existingImages: StoryboardImage[],
  newTemplate: Template
): MergeStoryboardResult {
  const existingById = new Map(existingImages.map((img) => [img.sceneId, img]));
  const newIds = new Set(newTemplate.scenes.map((s) => s.id));

  const images = newTemplate.scenes.map((templateScene, index) => {
    const existing = existingById.get(templateScene.id);
    if (!existing) {
      return buildEmptyStoryboardImage(templateScene, index + 1);
    }
    return { ...existing, order: index + 1 };
  });

  const removedWithData = existingImages
    .filter((img) => !newIds.has(img.sceneId) && (img.imagePath || img.status === 'generating'))
    .map((img) => img.sceneId);

  return { images, removedWithData };
}

/** Merge ảnh background hiện có với template mới theo sceneId — cùng cách mergeStoryboardWithTemplate. */
export function mergeBackgroundsWithTemplate(
  existingImages: StoryboardImage[],
  newTemplate: Template
): MergeStoryboardResult {
  const existingById = new Map(existingImages.map((img) => [img.sceneId, img]));
  const newIds = new Set(newTemplate.scenes.map((s) => s.id));

  const images = newTemplate.scenes.map((templateScene, index) => {
    const existing = existingById.get(templateScene.id);
    if (!existing) {
      return buildEmptyBackgroundImage(templateScene, index + 1);
    }
    return { ...existing, order: index + 1 };
  });

  const removedWithData = existingImages
    .filter((img) => !newIds.has(img.sceneId) && (img.imagePath || img.status === 'generating'))
    .map((img) => img.sceneId);

  return { images, removedWithData };
}

/** Gợi ý prompt ảnh storyboard từ nội dung cảnh đã duyệt trong script (ưu tiên veoPrompt — mô tả
 * hình ảnh chi tiết đã chốt, fallback về label nếu veoPrompt còn trống). */
function seedStoryboardPromptFromScene(s: Scene): string {
  return s.veoPrompt || s.label;
}

function buildEmptyStoryboardImageFromScene(s: Scene, order: number): StoryboardImage {
  return {
    sceneId: s.id,
    order,
    prompt: seedStoryboardPromptFromScene(s),
    imagePath: null,
    status: 'idle',
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
  };
}

/**
 * Đồng bộ storyboard.images theo script.scenes hiện tại (khớp theo id) — dùng mỗi khi script
 * thay đổi cấu trúc (sinh nháp AI, thêm/xoá/kéo-thả cảnh) để ảnh storyboard luôn seed đúng nội
 * dung cảnh đã duyệt. Scene id trùng: giữ nguyên prompt/ảnh đã có (không ghi đè prompt đã chỉnh
 * tay ở Bước Storyboard). Scene id mới: seed prompt từ veoPrompt/label. Scene bị xoá khỏi script:
 * loại khỏi storyboard (file ảnh cũ nếu có vẫn còn trên đĩa, chỉ mất liên kết).
 */
export function mergeStoryboardWithScript(
  existingImages: StoryboardImage[],
  scenes: Scene[]
): StoryboardImage[] {
  const existingById = new Map(existingImages.map((img) => [img.sceneId, img]));
  return scenes.map((scene, index) => {
    const existing = existingById.get(scene.id);
    if (!existing) return buildEmptyStoryboardImageFromScene(scene, index + 1);
    return { ...existing, order: index + 1 };
  });
}

function buildEmptyBackgroundImageFromScene(s: Scene, order: number): StoryboardImage {
  return {
    sceneId: s.id,
    order,
    prompt: '',
    imagePath: null,
    status: 'idle',
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
  };
}

/** Đồng bộ backgrounds theo script.scenes hiện tại — cùng cách mergeStoryboardWithScript xử lý images,
 * nhưng scene mới seed prompt rỗng (không seed từ veoPrompt/label vì dễ dính mô tả sản phẩm). */
export function mergeBackgroundsWithScript(
  existingImages: StoryboardImage[],
  scenes: Scene[]
): StoryboardImage[] {
  const existingById = new Map(existingImages.map((img) => [img.sceneId, img]));
  return scenes.map((scene, index) => {
    const existing = existingById.get(scene.id);
    if (!existing) return buildEmptyBackgroundImageFromScene(scene, index + 1);
    return { ...existing, order: index + 1 };
  });
}

export function createNewProject(params: {
  id: string;
  name: string;
  template: Template;
  product: ProductInfo;
  aspectRatio: '9:16' | '16:9';
  productImages: string[];
  templatePath: string;
  backgroundPath: string | null;
  spokespersonImagePath: string | null;
}): Project {
  const now = new Date().toISOString();
  const scenes = buildScenesFromTemplate(params.template);
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

  return {
    id: params.id,
    name: params.name,
    createdAt: now,
    updatedAt: now,
    currentStep: 1,
    aspectRatio: params.aspectRatio,
    veoModel: DEFAULT_VEO_MODEL,
    sceneChaining: true,
    burnOnScreenText: false,
    flowProjectId: null,
    template: params.template,
    product: params.product,
    inputs: {
      productImages: params.productImages,
      templatePath: params.templatePath,
      backgroundPath: params.backgroundPath,
      spokespersonImagePath: params.spokespersonImagePath,
    },
    storyboard: {
      model: DEFAULT_STORYBOARD_MODEL,
      useProductReference: true,
      useSpokespersonReference: true,
      images: buildStoryboardFromTemplate(params.template),
      backgrounds: buildBackgroundsFromTemplate(params.template),
    },
    script: {
      totalDuration,
      aspectRatio: params.aspectRatio,
      scenes,
    },
    scriptAngleId: null,
    music: {
      path: null,
      volume: 0.12,
      fadeOutDuration: 5,
    },
    concat: {
      status: 'idle',
      log: [],
      outputPath: null,
      outputUrl: null,
      outputMeta: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    },
    flowStatusCache: {
      flowConnected: null,
      geminiConnected: null,
      projectsError: null,
      checkedAt: null,
    },
  };
}
