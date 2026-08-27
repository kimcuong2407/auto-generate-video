import path from 'node:path';
import { readProject, updateProject } from './projectStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { ChatApiError, chatCompletion } from '../ai/chatClient';
import { readImagesAsBase64 } from './productVisionExtract';
import { projectInputsDir } from '../paths';
import { ensureLocalFile } from '../r2/client';
import type { Project, Scene } from '../types';

const SYSTEM_PROMPT = `Bạn là chuyên gia thiết kế key frame (khung hình mở đầu) cho video review sản phẩm ngắn (TikTok/Reels).

Nhiệm vụ: viết 1 prompt tiếng Việt, chi tiết, dùng cho AI sinh ẢNH TĨNH (image generation model) mô tả ĐÚNG 1
KHUNG HÌNH DUY NHẤT — chính là khoảnh khắc MỞ ĐẦU của cảnh quay đã chốt.

Ảnh này KHÔNG dùng cho người xem duyệt: nó được nạp thẳng vào model sinh video (Google Veo) làm KHUNG HÌNH
KHỞI ĐIỂM. Vì vậy nó phải là 1 frame liền lạc như ảnh chụp thật từ máy quay, KHÔNG được là lưới nhiều ô,
KHÔNG contact sheet, KHÔNG collage, KHÔNG viền/khung phân tách, KHÔNG chia panel, KHÔNG ghép nhiều khoảnh
khắc vào cùng 1 ảnh.

Yêu cầu:
- Mô tả ĐÚNG trạng thái tại giây đầu tiên của cảnh: chủ thể đang ở tư thế/vị trí nào, tay đặt ở đâu, sản
  phẩm đang được cầm/đặt ra sao. KHÔNG mô tả diễn biến, KHÔNG mô tả chuyển động về sau, KHÔNG mô tả âm
  thanh/lời thoại — đây là ảnh tĩnh, chuyển động sẽ do model video tự sinh tiếp từ khung hình này.
- Bố cục/khung hình phải hợp với tỉ lệ khung hình của video được nêu bên dưới (dọc 9:16 hay ngang 16:9), chủ
  thể đặt đúng vị trí để cảnh quay bắt đầu tự nhiên từ đây.
- Phong cách ảnh photorealistic — chân thực như chụp bằng máy ảnh/điện thoại thật, có khiếm khuyết tự nhiên,
  KHÔNG phải minh hoạ/illustration/3D render/cartoon, không bóng bẩy giả tạo kiểu studio hoàn hảo.
- QUAN TRỌNG về hình dạng/màu sắc/chất liệu sản phẩm: ảnh sản phẩm THẬT được gửi kèm làm reference và nó là
  nguồn đáng tin cậy DUY NHẤT về hình dáng. Hãy gọi sản phẩm bằng cụm trung tính "đúng sản phẩm trong ảnh reference" kèm tối đa màu tổng thể. TUYỆT ĐỐI KHÔNG mô tả lại các chi tiết hình học đếm được hay
  đặc trưng cấu tạo (số lỗ xỏ dây, số nút, số ngăn, kiểu hoa văn đế, loại vân bề mặt, kiểu khớp nối...) —
  ảnh reference đã thể hiện chính xác hơn mọi câu chữ, mô tả thừa bằng chữ chỉ khiến model vẽ lệch đi so với
  sản phẩm thật. Chỉ được nêu màu/chất liệu tổng quát nếu phần "Mô tả hình ảnh thật từ ảnh sản phẩm" bên dưới
  có nêu, và tuyệt đối không bịa thêm.
- Bám sát bối cảnh, ánh sáng, góc máy, cỡ cảnh của cảnh quay đã chốt được cung cấp bên dưới.
- Trả về DUY NHẤT đoạn prompt tiếng Việt, không kèm giải thích, không markdown, không xuống dòng thừa, không
  bọc trong dấu ngoặc kép.`;

/**
 * Số ảnh tối đa gửi kèm mỗi lượt viết prompt. Ảnh sản phẩm chiếm phần lớn suất (hình dáng là
 * thứ dễ bịa nhất), chừa chỗ cho ảnh mẫu + ảnh background nếu người dùng có tải lên.
 */
const MAX_PRODUCT_IMAGES = 3;

interface RefImageSet {
  images: Awaited<ReturnType<typeof readImagesAsBase64>>;
  /** Chú thích thứ tự ảnh cho model biết ảnh nào là gì (model chỉ thấy 1 dãy ảnh không nhãn). */
  legend: string;
}

/**
 * Gom ảnh người dùng đã tải lên ở Bước 1 để gửi THẲNG cho model khi viết prompt: ảnh sản phẩm
 * (hình dáng/màu/chất liệu thật), ảnh mẫu (người dẫn), ảnh background (bối cảnh).
 *
 * Vì sao cần: trước đây khâu này chỉ nhận `visualDescription` — bản mô tả bằng chữ do vision
 * đọc ở bước sinh kịch bản. Qua một lần diễn giải, cấu tạo sản phẩm bị mất chi tiết, còn ảnh
 * mẫu và ảnh background thì model CHƯA BAO GIỜ nhìn thấy, nên prompt tả người/bối cảnh hoàn
 * toàn tự bịa. Gửi ảnh gốc để model tự nhìn là nguồn chính xác nhất.
 *
 * Best-effort: thiếu ảnh / đọc lỗi đều trả về mảng rỗng, caller vẫn viết prompt bằng text.
 */
/** Ảnh reference đã chọn (thuần dữ liệu, chưa đọc file) — tách riêng để test được. */
interface RefEntry {
  rel: string;
  url: string | null | undefined;
  label: string;
}

/**
 * Chọn ảnh nào được gửi kèm + gán nhãn, thuần tính toán trên `project.inputs`.
 * Không đụng filesystem/R2 nên test được trực tiếp (scripts/check-prompt-ref-images.ts).
 */
function pickReferenceEntries(
  inputs: Pick<
    Project['inputs'],
    'productImages' | 'productImageUrls' | 'spokespersonImagePath' | 'spokespersonImageUrl' | 'backgroundPath' | 'backgroundUrl'
  >,
  opts: { includeProduct?: boolean; includeSpokesperson?: boolean }
): RefEntry[] {
  const { includeProduct = true, includeSpokesperson = true } = opts;
  const entries: RefEntry[] = [];

  if (includeProduct) {
    // Bỏ ảnh bìa marketing khi có dư ảnh — cùng heuristic với extractVisualDescription().
    const all = inputs.productImages;
    const offset = all.length > MAX_PRODUCT_IMAGES ? 1 : 0;
    all.slice(offset, offset + MAX_PRODUCT_IMAGES).forEach((rel, i) => {
      entries.push({
        rel,
        // Index gốc trong productImages — productImageUrls song song theo index, không tra theo
        // giá trị (ảnh trùng đường dẫn sẽ lấy nhầm URL).
        url: inputs.productImageUrls?.[offset + i],
        label: `ảnh SẢN PHẨM THẬT ${i + 1}`,
      });
    });
  }
  if (includeSpokesperson && inputs.spokespersonImagePath) {
    entries.push({
      rel: inputs.spokespersonImagePath,
      url: inputs.spokespersonImageUrl,
      label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN',
    });
  }
  if (inputs.backgroundPath) {
    entries.push({ rel: inputs.backgroundPath, url: inputs.backgroundUrl, label: 'ảnh BỐI CẢNH/BACKGROUND' });
  }
  return entries;
}

/**
 * Gom ảnh người dùng đã tải lên ở Bước 1 để gửi THẲNG cho model khi viết prompt: ảnh sản phẩm
 * (hình dáng/màu/chất liệu thật), ảnh mẫu (người dẫn), ảnh background (bối cảnh).
 *
 * Vì sao cần: trước đây khâu này chỉ nhận `visualDescription` — bản mô tả bằng chữ do vision
 * đọc ở bước sinh kịch bản. Qua một lần diễn giải, cấu tạo sản phẩm bị mất chi tiết, còn ảnh
 * mẫu và ảnh background thì model CHƯA BAO GIỜ nhìn thấy, nên prompt tả người/bối cảnh hoàn
 * toàn tự bịa. Gửi ảnh gốc để model tự nhìn là nguồn chính xác nhất.
 *
 * Best-effort: thiếu ảnh / đọc lỗi đều trả về mảng rỗng, caller vẫn viết prompt bằng text.
 */
async function collectReferenceImages(
  project: Project,
  opts: { includeProduct?: boolean; includeSpokesperson?: boolean } = {}
): Promise<RefImageSet> {
  const entries = pickReferenceEntries(project.inputs, opts);
  if (entries.length === 0) return { images: [], legend: '' };

  const absOf = (rel: string) => path.join(projectInputsDir(project.id), path.basename(rel));
  // Khôi phục file local từ R2 nếu mất (project tạo ở máy khác với máy đang gen).
  await Promise.all(entries.map((e) => ensureLocalFile(absOf(e.rel), e.url).catch(() => {})));
  const images = await readImagesAsBase64(entries.map((e) => absOf(e.rel)));
  // readImagesAsBase64 bỏ qua ảnh lỗi nên legend chỉ đúng khi đọc được toàn bộ; đọc thiếu thì
  // mô tả chung chung còn hơn gán nhãn lệch ảnh.
  const legend =
    images.length === entries.length
      ? entries.map((e, i) => `  ${i + 1}. ${e.label}`).join('\n')
      : entries.map((e) => e.label).join(', ');
  return { images, legend };
}

/** Khối nhắc model dùng ảnh đính kèm làm nguồn sự thật, rỗng nếu không gửi được ảnh nào. */
function buildImageLegendBlock(refs: RefImageSet): string {
  if (refs.images.length === 0) return '';
  return `\n\nẢNH THẬT ĐÍNH KÈM (nhìn kỹ trước khi viết — đây là nguồn sự thật, ưu tiên hơn mọi mô tả bằng chữ ở trên):\n${refs.legend}\nDùng đúng hình dáng/cấu tạo/màu/chất liệu sản phẩm, đúng ngoại hình người mẫu, đúng bối cảnh như trong ảnh. KHÔNG bịa khác, KHÔNG mô tả chi tiết hình học đếm được bằng chữ.`;
}

function buildProductDescription(project: Project): string {
  const p = project.product;
  const base = [
    p.name && `Tên sản phẩm: ${p.name}`,
    p.tagline && `Tagline: ${p.tagline}`,
    p.category && `Danh mục: ${p.category}`,
    p.material && `Chất liệu: ${p.material}`,
    p.colors.length > 0 && `Màu sắc: ${p.colors.join(', ')}`,
    p.keyFeatures.length > 0 && `Tính năng nổi bật: ${p.keyFeatures.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');

  // Mô tả hình ảnh thật do AI vision đọc từ ảnh — nguồn màu/chất liệu đáng tin cậy nhất,
  // đánh dấu ưu tiên tuyệt đối để system prompt buộc dùng đúng, tránh bịa màu.
  const visual = project.product.visualDescription?.trim();
  if (visual) {
    return `${base}\n\nMô tả hình ảnh thật từ ảnh sản phẩm (ƯU TIÊN TUYỆT ĐỐI — dùng đúng màu/chất liệu/hình dạng này, KHÔNG được bịa khác):\n${visual}`;
  }
  return base;
}

function buildUserPrompt(project: Project, scene: Scene): string {
  const productDesc = buildProductDescription(project) || '(không có mô tả sản phẩm)';
  const orientation = project.aspectRatio === '9:16' ? 'dọc (portrait)' : 'ngang (landscape)';
  return [
    `Thông tin sản phẩm (Bước 1):\n${productDesc}`,
    `Tỉ lệ khung hình video: ${project.aspectRatio} — ${orientation}. Bố cục ảnh phải hợp tỉ lệ này.`,
    `Cảnh quay đã duyệt (Bước 2):`,
    `- Tên cảnh: ${scene.label}`,
    `- Loại cảnh: ${scene.type || 'không rõ'}`,
    `- Góc máy: ${scene.camera}`,
    `- On-screen text: ${scene.onScreenText || '(không có)'}`,
    `- Mô tả video (veoPrompt): ${scene.veoPrompt || '(chưa có, dựa vào tên cảnh và loại cảnh)'}`,
    `\nViết prompt tiếng Việt cho ĐÚNG 1 khung hình tĩnh: khoảnh khắc MỞ ĐẦU của cảnh này.`,
  ].join('\n');
}

/**
 * Gọi AI viết prompt. Có ảnh đính kèm thì phải đi qua AI_VISION_MODEL (model chat mặc định
 * không nhìn được ảnh); không có ảnh / chưa cấu hình vision model thì dùng đường text như cũ.
 */
async function runPromptGeneration(system: string, user: string, refs: RefImageSet): Promise<string> {
  const visionModel = process.env.AI_VISION_MODEL || '';
  if (refs.images.length > 0 && visionModel) {
    return chatCompletion(system, user, { model: visionModel, images: refs.images });
  }
  return generateScriptText(system, user);
}

function sanitizePromptText(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ');
}

export async function generateStoryboardPromptText(project: Project, scene: Scene): Promise<string> {
  const refs = await collectReferenceImages(project);
  const raw = await runPromptGeneration(
    SYSTEM_PROMPT,
    buildUserPrompt(project, scene) + buildImageLegendBlock(refs),
    refs
  );
  const prompt = sanitizePromptText(raw);
  if (!prompt) {
    throw new ChatApiError('AI không trả về prompt hợp lệ');
  }
  return prompt;
}

export interface TriggerPromptResult {
  sceneId: string;
  ok: boolean;
  prompt?: string;
  error?: string;
}

/** Sinh prompt ảnh storyboard bằng AI cho 1 scene rồi lưu ngay vào project.json. */
export async function triggerStoryboardPromptGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerPromptResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.images.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene storyboard không tồn tại' };
  }
  if (image.status === 'generating') {
    return { sceneId, ok: false, error: 'Ảnh đang generating, không thể sửa prompt' };
  }
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return { sceneId, ok: false, error: 'Không tìm thấy cảnh tương ứng trong kịch bản (Bước 2)' };
  }

  try {
    const prompt = await generateStoryboardPromptText(project, scene);
    await updateProject(projectId, (p) => {
      const img = p.storyboard.images.find((x) => x.sceneId === sceneId);
      if (img) img.prompt = prompt;
    });
    return { sceneId, ok: true, prompt };
  } catch (err) {
    const message = err instanceof ChatApiError ? err.message : (err as Error).message;
    return { sceneId, ok: false, error: message };
  }
}

const BACKGROUND_SYSTEM_PROMPT = `Bạn là chuyên gia thiết kế bối cảnh (environment/background art) cho video review sản phẩm ngắn (TikTok/Reels).

Nhiệm vụ: viết 1 prompt tiếng Việt, chi tiết, dùng cho AI sinh ẢNH TĨNH (image generation model) mô tả ĐÚNG 1
ẢNH BỐI CẢNH/MÔI TRƯỜNG THUẦN TÚY cho 1 cảnh quay trong kịch bản đã duyệt.

Yêu cầu:
- Mô tả rõ: không gian/địa điểm, bố cục, góc máy, ánh sáng, tông màu, chất liệu bề mặt xung quanh (bàn, nền,
  tường, đạo cụ trang trí không liên quan trực tiếp sản phẩm...), phong cách ảnh photorealistic — chân thực
  như chụp bằng máy ảnh/điện thoại thật, KHÔNG phải minh hoạ/illustration/3D render/cartoon.
- TUYỆT ĐỐI KHÔNG được xuất hiện sản phẩm đang review, KHÔNG xuất hiện người/nhân vật/bộ phận cơ thể người
  trong khung hình — đây chỉ là ảnh bối cảnh trống để làm nền tham chiếu, sản phẩm sẽ được ghép/thêm vào sau.
- Không mô tả chuyển động, không mô tả âm thanh/lời thoại.
- Bám sát bối cảnh/không gian ngụ ý trong nội dung cảnh quay đã chốt (mô tả video, góc máy) được cung cấp bên
  dưới — nhưng chỉ lấy phần bối cảnh, bỏ qua mọi chi tiết mô tả sản phẩm/nhân vật.
- Trả về DUY NHẤT đoạn prompt tiếng Việt, không kèm giải thích, không markdown, không xuống dòng thừa, không
  bọc trong dấu ngoặc kép.`;

function buildBackgroundUserPrompt(scene: Scene): string {
  return [
    `Cảnh quay đã duyệt (Bước 2):`,
    `- Tên cảnh: ${scene.label}`,
    `- Loại cảnh: ${scene.type || 'không rõ'}`,
    `- Góc máy: ${scene.camera}`,
    `- Mô tả video (veoPrompt, chỉ lấy phần bối cảnh/không gian, bỏ qua mô tả sản phẩm/nhân vật): ${
      scene.veoPrompt || '(chưa có, dựa vào tên cảnh và loại cảnh)'
    }`,
    `\nViết prompt ảnh bối cảnh (background-only, không có sản phẩm/người) tiếng Việt cho đúng cảnh này.`,
  ].join('\n');
}

export async function generateBackgroundPromptText(scene: Scene, project?: Project): Promise<string> {
  // Chỉ gửi ảnh BỐI CẢNH — prompt này cấm sản phẩm/người xuất hiện trong khung, gửi kèm ảnh
  // sản phẩm/người mẫu chỉ kéo model vẽ chúng vào ảnh nền.
  const refs = project
    ? await collectReferenceImages(project, { includeProduct: false, includeSpokesperson: false })
    : { images: [], legend: '' };
  const raw = await runPromptGeneration(
    BACKGROUND_SYSTEM_PROMPT,
    buildBackgroundUserPrompt(scene) + buildImageLegendBlock(refs),
    refs
  );
  const prompt = sanitizePromptText(raw);
  if (!prompt) {
    throw new ChatApiError('AI không trả về prompt hợp lệ');
  }
  return prompt;
}

/** Sinh prompt ảnh background bằng AI cho 1 scene rồi lưu ngay vào project.json. */
export async function triggerBackgroundPromptGeneration(
  projectId: string,
  sceneId: string
): Promise<TriggerPromptResult> {
  const project = await readProject(projectId);
  const image = project.storyboard.backgrounds.find((img) => img.sceneId === sceneId);
  if (!image) {
    return { sceneId, ok: false, error: 'Scene background không tồn tại' };
  }
  if (image.status === 'generating') {
    return { sceneId, ok: false, error: 'Ảnh đang generating, không thể sửa prompt' };
  }
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return { sceneId, ok: false, error: 'Không tìm thấy cảnh tương ứng trong kịch bản (Bước 2)' };
  }

  try {
    const prompt = await generateBackgroundPromptText(scene, project);
    await updateProject(projectId, (p) => {
      const img = p.storyboard.backgrounds.find((x) => x.sceneId === sceneId);
      if (img) img.prompt = prompt;
    });
    return { sceneId, ok: true, prompt };
  } catch (err) {
    const message = err instanceof ChatApiError ? err.message : (err as Error).message;
    return { sceneId, ok: false, error: message };
  }
}

/** Chỉ dùng cho scripts/check-prompt-ref-images.ts — không import ở code chạy thật. */
export const __testables = { pickReferenceEntries };
