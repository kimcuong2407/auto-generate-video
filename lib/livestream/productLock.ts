import { readJob, updateJob } from './jobStore';
import { chatCompletion } from '../ai/chatClient';
import { withAiCallContext } from '../ai/callLog';
import { readImagesAsBase64 } from '../data/productVisionExtract';
import { extractJson } from '../ai/jsonExtract';
import { ensureLocalImage } from './imageR2';
import { resolveWithinJob } from './paths';
import { PRODUCT_LOCK_SYSTEM_PROMPT } from './promptDefaults';
import { loadPromptSet } from './promptStore';
import type { LivestreamJob, LivestreamProductLock } from './types';

/**
 * Dấu vết input mà product lock phụ thuộc — CHỈ gồm ảnh sản phẩm, không gồm ảnh mẫu/ảnh nền.
 *
 * Vì sao hẹp hơn stageBibleFingerprint: lock tả NGOẠI HÌNH MÓN HÀNG, đổi ảnh người dẫn hay đổi
 * ảnh phòng live không làm món hàng khác đi. Dùng chung fingerprint của bible thì mỗi lần Mr.D
 * đổi ảnh mẫu là lock bị chốt lại vô ích, tốn thêm một lượt vision mỗi lần.
 *
 * Sort để bỏ chọn rồi chọn lại 1 ảnh (đảo thứ tự mảng, cùng bộ ảnh) không bị tính là lệch.
 */
export function productLockFingerprint(
  job: Pick<LivestreamJob, 'selectedRefImagePaths'> & Partial<Pick<LivestreamJob, 'scriptRefPaths'>>
): string {
  return JSON.stringify({
    refs: [...(job.selectedRefImagePaths ?? [])].sort(),
    scriptRefs: [...(job.scriptRefPaths ?? [])].sort(),
  });
}

/** Lock đã chốt có còn khớp bộ ảnh sản phẩm hiện tại hay không. */
export function isProductLockStale(
  job: Pick<LivestreamJob, 'productLock' | 'selectedRefImagePaths'> &
    Partial<Pick<LivestreamJob, 'scriptRefPaths'>>
): boolean {
  if (!job.productLock) return false;
  return job.productLock.inputsFingerprint !== productLockFingerprint(job);
}

/**
 * Ảnh SẢN PHẨM để chốt lock — giao của ảnh Mr.D tick cho bước script với danh sách ảnh sản phẩm.
 *
 * Phải giao chứ không lấy thẳng scriptRefPaths: danh sách đó gồm cả ảnh mẫu và ảnh nền, đưa vào
 * đây thì lock sẽ đi tả người dẫn hoặc căn phòng thay vì món hàng. Đúng cùng phép lọc mà route
 * sinh script đang dùng cho describeProductAppearance.
 */
/**
 * User prompt bước khoá ngoại hình — cố định, không phụ thuộc job.
 *
 * Nói rõ đây là CÙNG 1 sản phẩm chụp nhiều góc, nếu không model tả thành nhiều món khác nhau —
 * cùng cái bẫy mà describeProductAppearance đã gặp. Export để route preview hiện đúng chuỗi gửi đi.
 */
export const PRODUCT_LOCK_USER_PROMPT =
  'Các ảnh dưới đây đều là CÙNG 1 sản phẩm chụp từ nhiều góc/biến thể màu. Chốt bản mô tả ngoại hình cố định của sản phẩm đó.';

export function pickProductLockRefPaths(
  job: Pick<LivestreamJob, 'selectedRefImagePaths'> & Partial<Pick<LivestreamJob, 'scriptRefPaths'>>
): string[] {
  const all = job.selectedRefImagePaths ?? [];
  const chosen = job.scriptRefPaths ?? [];
  return chosen.length > 0 ? chosen.filter((rel) => all.includes(rel)) : all;
}

/**
 * Lấy (hoặc chốt lần đầu rồi cache vào job) "product lock" — mô tả CỐ ĐỊNH ngoại hình sản phẩm
 * dùng chung cho MỌI cảnh của job.
 *
 * Vì sao cần cache: trước đây `describeProductAppearance` được gọi lại từ đầu MỖI LẦN sinh script
 * và kết quả không lưu ở đâu, nên sinh lại 1 sản phẩm lẻ ra mô tả khác lần trước — cùng món hàng
 * mà veoPrompt tả khác nhau giữa các sản phẩm đã gen. Chốt 1 lần rồi tái dùng vừa hết lệch vừa
 * tiết kiệm đúng lượt vision đó ở các lần sinh sau.
 *
 * Best-effort ở nhánh KHÔNG force: thiếu AI_VISION_MODEL, chưa chọn ảnh, hay lỗi mạng đều trả
 * null và KHÔNG chặn sinh script — chỉ mất phần mô tả bổ sung, giống hệt hành vi trước đây.
 *
 * `force: true` = Mr.D chủ động bấm chạy riêng bước này, nên NÉM lỗi kèm lý do thật thay vì trả
 * null. Trả null ở nhánh đó là im lặng nuốt: nút báo thành công trong khi không có gì được chốt,
 * và cả 3 nguyên nhân (chưa chọn ảnh / thiếu env / AI lỗi) trông y hệt nhau. Cùng chính sách với
 * ensureStageBible — xem doc-comment ở nhánh catch của nó.
 */
export async function ensureProductLock(
  jobId: string,
  opts: { force?: boolean } = {}
): Promise<LivestreamProductLock | null> {
  const job = await readJob(jobId);
  if (!opts.force && job.productLock && !isProductLockStale(job)) return job.productLock;

  const refPaths = pickProductLockRefPaths(job);
  if (refPaths.length === 0) {
    if (opts.force) {
      throw new Error(
        'Chưa chọn ảnh sản phẩm nào cho bước này — hãy tick ảnh sản phẩm ở phần cấu hình ảnh của job rồi chạy lại.'
      );
    }
    return null;
  }

  const visionModel = process.env.AI_VISION_MODEL || '';
  if (!visionModel) {
    if (opts.force) {
      throw new Error(
        'Chưa cấu hình AI_VISION_MODEL trong .env.local — không đọc được ảnh để khoá ngoại hình sản phẩm.'
      );
    }
    return null;
  }

  try {
    await Promise.all(
      refPaths.map((rel) => ensureLocalImage(job.id, rel, job.imageR2Urls?.[rel]).catch(() => {}))
    );
    const images = await readImagesAsBase64(refPaths.map((rel) => resolveWithinJob(job.id, rel)));
    if (images.length === 0) {
      // Ném cả ở nhánh không force: catch bên dưới sẽ nuốt lại thành null đúng như cũ, còn nhánh
      // force thì lỗi đi thẳng ra ngoài kèm nguyên nhân.
      throw new Error(
        'Không đọc được ảnh sản phẩm nào (mất file local và không khôi phục được từ R2) — hãy tải lại ảnh.'
      );
    }

    const prompts = await loadPromptSet(job.slug);
    const raw = await withAiCallContext(
      {
        stepKey: 'product_lock',
        jobSlug: job.slug,
        promptScope: prompts.scopeOf('product_lock'),
        imagePaths: refPaths,
      },
      () =>
        chatCompletion(prompts.get('product_lock'), PRODUCT_LOCK_USER_PROMPT, {
          model: visionModel,
          images,
        })
    );
    const parsed = JSON.parse(extractJson(raw)) as Partial<LivestreamProductLock>;
    const required = ['shape', 'color', 'material', 'size'] as const;
    for (const key of required) {
      if (!parsed[key]?.trim()) throw new Error(`product lock thiếu trường "${key}"`);
    }

    const lock: LivestreamProductLock = {
      shape: parsed.shape!.trim(),
      color: parsed.color!.trim(),
      material: parsed.material!.trim(),
      size: parsed.size!.trim(),
      components: parsed.components?.trim() || '',
      neverChange: parsed.neverChange?.trim() || '',
      inputsFingerprint: productLockFingerprint(job),
    };
    await updateJob(jobId, (j) => {
      j.productLock = lock;
    });
    return lock;
  } catch (err) {
    // force = Mr.D bấm chạy riêng bước này: phải thấy lý do thật, không nuốt thành null.
    if (opts.force) throw err;
    // Không chặn luồng sinh script, nhưng phải LOG chứ không im lặng — cùng chính sách với
    // ensureStageBible ở nhánh không force.
    console.error(`[productLock] chốt khoá sản phẩm thất bại cho job ${jobId}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Khối text ép LLM tả sản phẩm đúng lock đã chốt — ghép vào user prompt từng sản phẩm.
 *
 * Đặt là "nguồn sự thật DUY NHẤT" và yêu cầu copy nguyên văn, cùng cách formatStageBibleBlock ép
 * người dẫn: mô tả gợi ý thì LLM diễn đạt lại mỗi cảnh một khác, đó chính là đường sản phẩm biến
 * hình giữa các cảnh.
 */
export function formatProductLockBlock(lock: LivestreamProductLock): string {
  const lines = [
    `- Hình dạng: ${lock.shape}`,
    `- Màu sắc: ${lock.color}`,
    `- Chất liệu & bề mặt: ${lock.material}`,
    `- Kích thước & cách cầm: ${lock.size}`,
  ];
  if (lock.components) lines.push(`- Bộ phận cố định: ${lock.components}`);
  if (lock.neverChange) lines.push(`- TUYỆT ĐỐI KHÔNG ĐỔI: ${lock.neverChange}`);

  return `KHOÁ NGOẠI HÌNH SẢN PHẨM (đọc từ ảnh thật — đây là nguồn sự thật DUY NHẤT về món hàng này,
thắng mọi mô tả sản phẩm bằng chữ ở phần khác của prompt):

${lines.join('\n')}

BẮT BUỘC: veoPrompt của MỌI cảnh phải tả sản phẩm ĐÚNG theo các cụm trên (copy nguyên văn phần
hình dạng/màu/chất liệu, không paraphrase, không rút gọn, không thêm chi tiết ngoại hình mới).
Quyết định cầm 1 tay hay 2 tay phải bám đúng dòng "Kích thước & cách cầm". Sản phẩm giữ NGUYÊN
những đặc điểm này ở TẤT CẢ các cảnh — không đổi màu, không đổi kích thước, không mọc thêm bộ
phận, không nhân bản thêm cái thứ hai khi lời thoại không nhắc tới.`;
}
