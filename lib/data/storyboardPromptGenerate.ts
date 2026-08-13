import { readProject, updateProject } from './projectStore';
import { generateScriptText } from '../mcp/flowJobs';
import { ChatApiError } from '../ai/chatClient';
import type { Project, Scene } from '../types';

const SYSTEM_PROMPT = `Bạn là chuyên gia thiết kế storyboard/concept art cho video review sản phẩm ngắn (TikTok/Reels).

Nhiệm vụ: viết 1 prompt tiếng Anh, chi tiết, dùng cho AI sinh ẢNH TĨNH (image generation model) mô tả 1 ẢNH
STORYBOARD DẠNG LƯỚI (contact sheet / grid) gồm ĐÚNG 8 Ô BẰNG NHAU (bố cục dạng lưới, ví dụ 4 cột × 2 hàng),
có viền/khung phân tách rõ giữa các ô như storyboard chuyên nghiệp trong sản xuất phim/quảng cáo.

Yêu cầu:
- Mỗi ô trong 8 ô mô tả 1 KHOẢNH KHẮC riêng biệt, cách đều nhau theo thời gian, nối tiếp nhau theo đúng thứ
  tự từ ô đầu tiên đến ô cuối cùng, phủ trọn vẹn cảnh quay từ lúc bắt đầu đến lúc kết thúc (8 khoảnh khắc chia
  đều theo thời lượng thực tế của cảnh — thông tin thời lượng và khoảng cách giữa các ô được cung cấp bên
  dưới, KHÔNG ghi cứng một con số giây cụ thể nào trong prompt, chỉ mô tả bằng lời là các khoảnh khắc chia đều
  theo thời gian).
- Xuyên suốt 8 ô: giữ NHẤT QUÁN chủ thể xuất hiện trong khung hình (đúng đặc điểm sản phẩm thật đã cho: tên,
  màu sắc, chất liệu, hình dạng — không bịa chi tiết mâu thuẫn với mô tả sản phẩm), bối cảnh/không gian, tông
  màu, phong cách ảnh photorealistic — chân thực như chụp bằng máy ảnh/điện thoại thật, KHÔNG phải minh
  hoạ/illustration/3D render/cartoon. Góc máy/bố cục có thể thay đổi nhẹ giữa các ô để thể hiện diễn biến,
  nhưng không phá vỡ tính nhất quán của chủ thể và bối cảnh.
- Mô tả rõ trong prompt: đây là ảnh dạng lưới 8 ô (8-panel storyboard grid / contact sheet), và tóm tắt ngắn
  gọn nội dung của từng ô theo đúng thứ tự.
- Bám sát nội dung cảnh quay đã chốt (mô tả video, góc máy, on-screen text) được cung cấp bên dưới.
- Trả về DUY NHẤT đoạn prompt tiếng Anh, không kèm giải thích, không markdown, không xuống dòng thừa, không
  bọc trong dấu ngoặc kép.`;

function buildProductDescription(project: Project): string {
  const p = project.product;
  return [
    p.name && `Tên sản phẩm: ${p.name}`,
    p.tagline && `Tagline: ${p.tagline}`,
    p.category && `Danh mục: ${p.category}`,
    p.material && `Chất liệu: ${p.material}`,
    p.colors.length > 0 && `Màu sắc: ${p.colors.join(', ')}`,
    p.keyFeatures.length > 0 && `Tính năng nổi bật: ${p.keyFeatures.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildUserPrompt(project: Project, scene: Scene): string {
  const productDesc = buildProductDescription(project) || '(không có mô tả sản phẩm)';
  const interval = (scene.duration / 8).toFixed(1);
  return [
    `Thông tin sản phẩm (Bước 1):\n${productDesc}`,
    `Cảnh quay đã duyệt (Bước 2):`,
    `- Tên cảnh: ${scene.label}`,
    `- Loại cảnh: ${scene.type || 'không rõ'}`,
    `- Góc máy: ${scene.camera}`,
    `- On-screen text: ${scene.onScreenText || '(không có)'}`,
    `- Mô tả video (veoPrompt): ${scene.veoPrompt || '(chưa có, dựa vào tên cảnh và loại cảnh)'}`,
    `- Thời lượng cảnh: ${scene.duration}s (8 ô chia đều ⇒ mỗi ô cách nhau ~${interval}s, KHÔNG ghi con số này`,
    `  vào prompt, chỉ dùng để hình dung nhịp độ diễn biến giữa các ô)`,
    `\nViết prompt ảnh storyboard dạng lưới 8 ô tiếng Anh cho đúng cảnh này.`,
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
