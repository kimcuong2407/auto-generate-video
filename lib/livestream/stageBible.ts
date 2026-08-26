import { readJob, updateJob } from './jobStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { chatCompletion } from '../ai/chatClient';
import { readImagesAsBase64 } from '../data/productVisionExtract';
import { extractJson } from '../ai/jsonExtract';
import { ensureLocalImage } from './imageR2';
import { resolveWithinJob } from './paths';
import { STAGE_BIBLE_SYSTEM_PROMPT } from './promptDefaults';
import type { LivestreamJob, LivestreamStageBible } from './types';

/**
 * Lấy (hoặc sinh lần đầu rồi cache vào job) "stage bible" — mô tả CỐ ĐỊNH người dẫn/bối cảnh/
 * góc máy/giọng dùng chung cho MỌI sản phẩm trong job.
 *
 * Vì sao cần: route sinh script gọi LLM RIÊNG cho từng sản phẩm, mỗi lần gọi là 1 context độc lập
 * nên LLM tự bịa người dẫn + phòng + giọng khác nhau cho từng sản phẩm → ghép lại thành nhiều buổi
 * live rời rạc thay vì 1 buổi live thống nhất. Chốt 1 lần ở cấp job rồi ép vào mọi user prompt là
 * cách rẻ nhất để mọi sản phẩm dùng chung 1 sân khấu.
 *
 * Cache trong job.stageBible: sinh lại script cho từng sản phẩm vẫn dùng đúng bible cũ (nếu không
 * thì gen lại 1 sản phẩm sẽ lệch khỏi các sản phẩm đã gen trước đó). Muốn đổi sân khấu → xoá bible
 * (force = true).
 */
export async function ensureStageBible(
  jobId: string,
  opts: { force?: boolean; visualDescription?: string } = {}
): Promise<LivestreamStageBible | null> {
  const job = await readJob(jobId);
  if (!opts.force && job.stageBible) return job.stageBible;

  try {
    const bible = await generateStageBible(job, opts.visualDescription);
    await updateJob(jobId, (j) => {
      j.stageBible = bible;
    });
    return bible;
  } catch {
    // Best-effort: lỗi mạng/AI không được chặn sinh script — chỉ mất tính nhất quán, như hành vi cũ.
    return null;
  }
}

/**
 * Đọc ảnh MẪU/NGƯỜI DẪN (job.selectedModelImagePath) + ảnh background đã chọn để gửi THẲNG cho
 * model khi chốt stage bible.
 *
 * Vì sao cần: trước đây bước này chỉ nhận `visualDescription` — mô tả bằng chữ do vision đọc từ ảnh
 * SẢN PHẨM, model CHƯA BAO GIỜ nhìn thấy ảnh mẫu nên tự bịa người dẫn (mặc định hay ra "woman" với
 * hàng mỹ phẩm dù ảnh mẫu là nam). Ảnh mẫu là nguồn sự thật duy nhất về giới tính/ngoại hình người dẫn.
 *
 * Best-effort: không có ảnh / đọc lỗi → mảng rỗng, caller vẫn chốt bible bằng text như cũ.
 */
async function collectStageRefImages(
  job: LivestreamJob
): Promise<{ images: Awaited<ReturnType<typeof readImagesAsBase64>>; legend: string }> {
  const entries: Array<{ rel: string; label: string }> = [];
  if (job.selectedModelImagePath) {
    entries.push({ rel: job.selectedModelImagePath, label: 'ảnh NGƯỜI MẪU/NGƯỜI DẪN' });
  }
  if (job.selectedBackgroundImagePath) {
    entries.push({ rel: job.selectedBackgroundImagePath, label: 'ảnh BỐI CẢNH/BACKGROUND' });
  }
  if (entries.length === 0) return { images: [], legend: '' };

  await Promise.all(
    entries.map((e) => ensureLocalImage(job.id, e.rel, job.imageR2Urls?.[e.rel]).catch(() => {}))
  );
  const images = await readImagesAsBase64(entries.map((e) => resolveWithinJob(job.id, e.rel)));
  // readImagesAsBase64 bỏ ảnh lỗi nên legend đánh số chỉ đúng khi đọc được toàn bộ.
  const legend =
    images.length === entries.length
      ? entries.map((e, i) => `  ${i + 1}. ${e.label}`).join('\n')
      : entries.map((e) => e.label).join(', ');
  return { images, legend };
}

async function generateStageBible(
  job: LivestreamJob,
  visualDescription?: string
): Promise<LivestreamStageBible> {
  const productList = job.products
    .map((p, i) => `${i + 1}. ${p.name}: ${p.description.slice(0, 400)}`)
    .join('\n');
  const visualBlock = visualDescription
    ? `\n\nMô tả ảnh reference (người mẫu/sản phẩm thật) — mô tả người dẫn phải khớp nếu ảnh có người:\n${visualDescription}`
    : '';
  const refs = await collectStageRefImages(job);
  const imageBlock =
    refs.images.length > 0
      ? `\n\nẢNH THẬT ĐÍNH KÈM (nhìn kỹ trước khi chốt — đây là nguồn sự thật, ưu tiên hơn MỌI mô tả bằng chữ ở trên):\n${refs.legend}\nNếu có ảnh NGƯỜI MẪU: "host" PHẢI tả ĐÚNG người trong ảnh — đúng GIỚI TÍNH (nhìn ảnh để xác định, KHÔNG mặc định theo loại sản phẩm), đúng độ tuổi, kiểu tóc, vóc dáng, trang phục và màu sắc trang phục. "voice" PHẢI khớp giới tính người trong ảnh (ảnh nam → giọng nam, ảnh nữ → giọng nữ). Nếu có ảnh BỐI CẢNH: "scene" phải tả đúng căn phòng/bàn/ánh sáng trong ảnh. TUYỆT ĐỐI KHÔNG bịa khác ảnh.`
      : '';
  const user = `Danh sách sản phẩm sẽ giới thiệu lần lượt trong buổi live này:\n${productList}${visualBlock}${imageBlock}`;

  // Có ảnh đính kèm thì phải đi qua AI_VISION_MODEL (model chat mặc định không nhìn được ảnh).
  const visionModel = process.env.AI_VISION_MODEL || '';
  const raw =
    refs.images.length > 0 && visionModel
      ? await chatCompletion(STAGE_BIBLE_SYSTEM_PROMPT, user, {
          model: visionModel,
          images: refs.images,
        })
      : await generateScriptText(STAGE_BIBLE_SYSTEM_PROMPT, user);
  const parsed = JSON.parse(extractJson(raw)) as Partial<LivestreamStageBible>;
  const required = ['host', 'scene', 'camera', 'voice'] as const;
  for (const key of required) {
    if (!parsed[key]?.trim()) throw new Error(`stage bible thiếu trường "${key}"`);
  }
  return {
    host: parsed.host!.trim(),
    scene: parsed.scene!.trim(),
    camera: parsed.camera!.trim(),
    voice: parsed.voice!.trim(),
    wardrobeLock: parsed.wardrobeLock?.trim() || '',
  };
}

/** Khối text ép LLM viết script dùng đúng sân khấu đã chốt — ghép vào user prompt từng sản phẩm. */
export function formatStageBibleBlock(bible: LivestreamStageBible): string {
  return `SÂN KHẤU CỐ ĐỊNH CỦA BUỔI LIVE (đã chốt sẵn cho TOÀN BỘ các sản phẩm trong buổi live này —
KHÔNG được tự nghĩ ra người dẫn/bối cảnh/góc máy/giọng khác, KHÔNG diễn đạt lại khác đi):

- Người dẫn (Subject): ${bible.host}
- Bối cảnh (Scene): ${bible.scene}
- Máy quay (Style): ${bible.camera}
- Chất giọng (Voice): ${bible.voice}
${bible.wardrobeLock ? `- Ràng buộc: ${bible.wardrobeLock}\n` : ''}
BẮT BUỘC: veoPrompt của MỌI đoạn phải chứa NGUYÊN VĂN các cụm mô tả tiếng Anh ở trên (copy y hệt,
không paraphrase, không rút gọn, không thêm chi tiết ngoại hình mới). Bỏ qua yêu cầu tự chốt người
dẫn/bối cảnh/giọng ở BƯỚC 1 của system prompt — đã chốt sẵn ở đây rồi. Sản phẩm trên bàn là thứ
DUY NHẤT thay đổi so với các sản phẩm khác trong buổi live.`;
}
