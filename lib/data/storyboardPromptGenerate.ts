import { readProject, updateProject } from './projectStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { ChatApiError } from '../ai/chatClient';
import type { Project, Scene } from '../types';

const SYSTEM_PROMPT = `Bạn là chuyên gia thiết kế key frame (khung hình mở đầu) cho video review sản phẩm ngắn (TikTok/Reels).

Nhiệm vụ: viết 1 prompt tiếng Anh, chi tiết, dùng cho AI sinh ẢNH TĨNH (image generation model) mô tả ĐÚNG 1
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
  nguồn đáng tin cậy DUY NHẤT về hình dáng. Hãy gọi sản phẩm bằng cụm trung tính "the exact product shown in
  the reference image" kèm tối đa màu tổng thể. TUYỆT ĐỐI KHÔNG mô tả lại các chi tiết hình học đếm được hay
  đặc trưng cấu tạo (số lỗ xỏ dây, số nút, số ngăn, kiểu hoa văn đế, loại vân bề mặt, kiểu khớp nối...) —
  ảnh reference đã thể hiện chính xác hơn mọi câu chữ, mô tả thừa bằng chữ chỉ khiến model vẽ lệch đi so với
  sản phẩm thật. Chỉ được nêu màu/chất liệu tổng quát nếu phần "Mô tả hình ảnh thật từ ảnh sản phẩm" bên dưới
  có nêu, và tuyệt đối không bịa thêm.
- Bám sát bối cảnh, ánh sáng, góc máy, cỡ cảnh của cảnh quay đã chốt được cung cấp bên dưới.
- Trả về DUY NHẤT đoạn prompt tiếng Anh, không kèm giải thích, không markdown, không xuống dòng thừa, không
  bọc trong dấu ngoặc kép.`;

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
    `\nViết prompt tiếng Anh cho ĐÚNG 1 khung hình tĩnh: khoảnh khắc MỞ ĐẦU của cảnh này.`,
  ].join('\n');
}

function sanitizePromptText(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s+/g, ' ');
}

export async function generateStoryboardPromptText(project: Project, scene: Scene): Promise<string> {
  const raw = await generateScriptText(SYSTEM_PROMPT, buildUserPrompt(project, scene));
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

Nhiệm vụ: viết 1 prompt tiếng Anh, chi tiết, dùng cho AI sinh ẢNH TĨNH (image generation model) mô tả ĐÚNG 1
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
- Trả về DUY NHẤT đoạn prompt tiếng Anh, không kèm giải thích, không markdown, không xuống dòng thừa, không
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
    `\nViết prompt ảnh bối cảnh (background-only, không có sản phẩm/người) tiếng Anh cho đúng cảnh này.`,
  ].join('\n');
}

export async function generateBackgroundPromptText(scene: Scene): Promise<string> {
  const raw = await generateScriptText(BACKGROUND_SYSTEM_PROMPT, buildBackgroundUserPrompt(scene));
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
    const prompt = await generateBackgroundPromptText(scene);
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
