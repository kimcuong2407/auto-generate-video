import { readJob, updateJob } from './jobStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { extractJson } from '../ai/jsonExtract';
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
  const user = `Danh sách sản phẩm sẽ giới thiệu lần lượt trong buổi live này:\n${productList}${visualBlock}`;

  const raw = await generateScriptText(STAGE_BIBLE_SYSTEM_PROMPT, user);
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
