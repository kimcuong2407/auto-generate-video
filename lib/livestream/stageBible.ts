import { readJob, updateJob } from './jobStore';
import { generateScriptText } from '../googleFlow/flowJobs';
import { chatCompletion } from '../ai/chatClient';
import { readImagesAsBase64 } from '../data/productVisionExtract';
import { extractJson } from '../ai/jsonExtract';
import { ensureLocalImage } from './imageR2';
import { pickVisionRefEntries, stageBibleFingerprint } from './refImages';
import { resolveWithinJob } from './paths';
import { STAGE_BIBLE_SYSTEM_PROMPT } from './promptDefaults';
import type { LivestreamJob, LivestreamStageBible } from './types';

/**
 * Bible đã chốt có còn khớp DỮ LIỆU ĐẦU VÀO hiện tại của job hay không. Lệch = bible đang tả sai
 * sân khấu (VD chốt "woman" khi chưa có ảnh mẫu, sau đó Mr.D mới upload ảnh người dẫn nam; hoặc
 * chốt xong mới chọn ảnh nền khác) → phải chốt lại.
 *
 * Hai lớp kiểm tra, lớp nào lệch cũng tính là stale:
 * - `inputsFingerprint`: toàn bộ input bible phụ thuộc (ảnh mẫu + ảnh sản phẩm + ảnh nền + danh
 *   sách sản phẩm). Đây là lớp chính.
 * - `modelImagePath`: giữ lại để bible do bản code cũ chốt (thiếu CẢ HAI field) vẫn bị bắt đúng
 *   như hành vi trước đây — job đang có ảnh mẫu thì chốt lại 1 lần rồi ghi đủ dấu vết, job không
 *   có ảnh mẫu thì khớp, không gọi AI vô ích.
 *
 * Job kèm `products` mới so được fingerprint; thiếu (caller cũ chỉ truyền 2 field) thì bỏ qua lớp
 * này và rơi về đúng hành vi cũ.
 */
export function isStageBibleStale(
  job: Pick<LivestreamJob, 'stageBible' | 'selectedModelImagePath'> &
    Partial<Pick<LivestreamJob, 'selectedRefImagePaths' | 'selectedBackgroundImagePath' | 'products'>>
): boolean {
  if (!job.stageBible) return false;
  if ((job.stageBible.modelImagePath ?? null) !== (job.selectedModelImagePath ?? null)) return true;
  if (!job.products) return false;
  return (
    job.stageBible.inputsFingerprint !==
    stageBibleFingerprint({
      selectedModelImagePath: job.selectedModelImagePath,
      selectedRefImagePaths: job.selectedRefImagePaths ?? [],
      selectedBackgroundImagePath: job.selectedBackgroundImagePath ?? null,
      products: job.products,
    })
  );
}

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
 * thì gen lại 1 sản phẩm sẽ lệch khỏi các sản phẩm đã gen trước đó). Muốn đổi sân khấu → force.
 *
 * NGOẠI LỆ tự động: bible chốt từ ảnh mẫu KHÁC ảnh mẫu hiện tại thì nó đang tả sai người dẫn —
 * chốt lại ngay dù caller không force. Không có ngoại lệ này thì job đã sinh script xong bị kẹt
 * vĩnh viễn với người dẫn sai: mọi sản phẩm đều scriptStatus='done' nên "Sinh script tất cả" không
 * còn target nào để chạy, mà sinh lại từng sản phẩm lẻ thì theo thiết kế vẫn giữ bible cũ.
 */
export async function ensureStageBible(
  jobId: string,
  opts: { force?: boolean; visualDescription?: string } = {}
): Promise<LivestreamStageBible | null> {
  const job = await readJob(jobId);
  if (!opts.force && job.stageBible && !isStageBibleStale(job)) return job.stageBible;

  try {
    const bible = await generateStageBible(job, opts.visualDescription);
    await updateJob(jobId, (j) => {
      j.stageBible = bible;
    });
    return bible;
  } catch (err) {
    // `force` = Mr.D bấm "Chốt lại sân khấu" vì sân khấu ĐANG SAI. Nuốt lỗi ở đây là hỏng nặng
    // nhất: caller nhận null → user prompt MẤT HẲN khối sân khấu → LLM rơi về "BƯỚC 1 tự chốt
    // người dẫn" và bịa ra người khác, trong khi UI báo thành công. Đã xảy ra 3 lần liên tiếp
    // trên job production 825314 (bible vẫn giữ fingerprint cũ, 32/32 đoạn ra người dẫn nữ dù
    // bible tả nam). Ném lỗi để route đánh dấu failed và hiện nguyên nhân thật.
    if (opts.force) throw err;
    // Không force: giữ hành vi best-effort cũ — lỗi mạng/AI không chặn luồng sinh script thường,
    // nhưng phải LOG chứ không im lặng.
    console.error(`[stageBible] chốt sân khấu thất bại cho job ${jobId}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Đọc MỌI ảnh Mr.D đã chọn (ảnh mẫu/người dẫn + ảnh sản phẩm + ảnh nền) để gửi THẲNG cho model khi
 * chốt stage bible — xem pickVisionRefEntries() ở refImages.ts để biết thứ tự và trần số ảnh.
 *
 * Vì sao cần: trước đây bước này chỉ nhận `visualDescription` — mô tả bằng chữ do vision đọc từ ảnh
 * SẢN PHẨM, model CHƯA BAO GIỜ nhìn thấy ảnh mẫu nên tự bịa người dẫn (mặc định hay ra "woman" dù
 * ảnh mẫu là nam). Ảnh là nguồn sự thật duy nhất về ngoại hình người dẫn lẫn bối cảnh/đạo cụ.
 *
 * Best-effort: không có ảnh / đọc lỗi → mảng rỗng, caller vẫn chốt bible bằng text như cũ.
 */
async function collectStageRefImages(
  job: LivestreamJob
): Promise<{ images: Awaited<ReturnType<typeof readImagesAsBase64>>; legend: string }> {
  const entries = pickVisionRefEntries(job);
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
      ? `\n\nẢNH THẬT ĐÍNH KÈM (nhìn kỹ trước khi chốt — đây là nguồn sự thật, ưu tiên hơn MỌI mô tả bằng chữ ở trên):\n${refs.legend}\nNếu có ảnh NGƯỜI MẪU: "host" PHẢI tả ĐÚNG người trong ảnh — đúng GIỚI TÍNH (nhìn ảnh để xác định, KHÔNG mặc định theo loại sản phẩm), đúng độ tuổi, kiểu tóc, vóc dáng, trang phục và màu sắc trang phục. "voice" PHẢI khớp giới tính người trong ảnh (ảnh nam → giọng nam, ảnh nữ → giọng nữ). Nếu có ảnh SẢN PHẨM THẬT: "scene" phải là không gian bày vừa và hợp lý với ĐÚNG món hàng trong ảnh (đúng kích thước, đúng loại mặt bàn/giá đỡ cần có); đạo cụ nhắc trong "scene" phải phù hợp sản phẩm thật, KHÔNG bịa thêm đồ vật không thấy trong ảnh. Nếu có ảnh BỐI CẢNH: "scene" phải tả đúng căn phòng/bàn/ánh sáng trong ảnh. TUYỆT ĐỐI KHÔNG bịa khác ảnh.`
      : '';
  const user = `Danh sách sản phẩm sẽ giới thiệu lần lượt trong buổi live này:\n${productList}${visualBlock}${imageBlock}`;

  // Có ảnh đính kèm thì phải đi qua AI_VISION_MODEL (model chat mặc định không nhìn được ảnh).
  const visionModel = process.env.AI_VISION_MODEL || '';
  // Có ảnh mẫu mà KHÔNG có vision model = chốt bible mù: model chỉ đọc được tên sản phẩm
  // ("Túi Chạy Bộ ... Nam Nữ") rồi tự đoán người dẫn — ra bible SAI chứ không phải null, nên
  // không nhánh nào phía trên bắt được. Ném lỗi để force dừng hẳn và nói đúng nguyên nhân,
  // thay vì âm thầm chốt sai rồi ghi đè 32 đoạn.
  if (job.selectedModelImagePath && refs.images.length > 0 && !visionModel) {
    throw new Error(
      'Job có ảnh người mẫu nhưng thiếu AI_VISION_MODEL trong .env — không đọc được ảnh để chốt đúng người dẫn. Hãy cấu hình AI_VISION_MODEL rồi chốt lại.'
    );
  }
  if (job.selectedModelImagePath && refs.images.length === 0) {
    throw new Error(
      'Không đọc được ảnh người mẫu đã chọn (mất file local và không khôi phục được từ R2) — chốt sân khấu lúc này sẽ bịa ra người dẫn khác. Hãy tải lại ảnh mẫu.'
    );
  }
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
    // Dấu vết ảnh mẫu đã dùng — lần sau đổi ảnh là biết bible cũ tả sai người, tự chốt lại.
    modelImagePath: job.selectedModelImagePath ?? null,
    // Dấu vết ĐẦY ĐỦ (ảnh sản phẩm + ảnh nền + danh sách sản phẩm) — xem isStageBibleStale.
    inputsFingerprint: stageBibleFingerprint(job),
  };
}

/**
 * Suy ra giới tính người dẫn từ mô tả bible để dựng câu cấm tường minh.
 *
 * Vì sao cần: bible tả "Nam, khoảng 35-40 tuổi, đầu cạo gọn..." mà LLM vẫn viết "người dẫn nữ 27
 * tuổi tóc đuôi ngựa" ở CẢ 8/8 đoạn (đã xác minh trên job production 825314, script sinh lúc
 * 10:07 sau khi bible nam đã chốt). Nguyên nhân: system prompt ra lệnh "BƯỚC 1 — tự chốt người
 * dẫn" bằng giọng bắt buộc suốt nhiều dòng, còn câu huỷ lệnh chỉ nằm lọt thỏm ở cuối khối này.
 * Một câu CẤM ngắn, đặt ở ĐẦU khối, nêu thẳng giới tính, thắng được lệnh dài phía trên.
 *
 * Heuristic thuần chuỗi: bible do chính ta ép model trả về tiếng Việt theo STAGE_BIBLE_SYSTEM_PROMPT
 * nên gần như luôn mở đầu bằng "Nam,"/"Nữ,". Không nhận ra được thì trả null và bỏ câu cấm —
 * ponytail: đủ cho dữ liệu ta tự sinh, cần chắc hơn thì thêm field gender vào bible.
 */
function detectHostGender(host: string): 'nam' | 'nữ' | null {
  const h = host.toLowerCase();
  // KHÔNG dùng \b: trong regex JS, chữ tiếng Việt có dấu ("ữ", "à") không phải word-char nên
  // /\bnữ\b/ KHÔNG BAO GIỜ khớp "nữ," — đã tự bẫy đúng lỗi này khi viết check. Dùng ranh giới
  // thủ công: đầu chuỗi hoặc khoảng trắng ở trước, và không phải chữ cái ở sau.
  const has = (words: string[]) =>
    words.some((w) => new RegExp(`(^|[\\s(,])${w}([\\s,.)]|$)`).test(h));
  const nam = has(['nam', 'đàn ông', 'người đàn ông', 'anh chàng', 'chàng trai']);
  const nu = has(['nữ', 'phụ nữ', 'người phụ nữ', 'cô gái', 'cô ấy']);
  if (nam === nu) return null; // không có dấu hiệu, hoặc lẫn cả hai → không đoán bừa
  return nam ? 'nam' : 'nữ';
}

/** Khối text ép LLM viết script dùng đúng sân khấu đã chốt — ghép vào user prompt từng sản phẩm. */
export function formatStageBibleBlock(bible: LivestreamStageBible): string {
  const gender = detectHostGender(bible.host);
  // Câu cấm đặt TRƯỚC mọi thứ khác: model đọc tuần tự, gặp lệnh "tự chốt người dẫn" ở system prompt
  // trước, nên câu huỷ lệnh phải là thứ ĐẦU TIÊN nó thấy trong user prompt, không phải dòng cuối.
  const genderLock = gender
    ? `⛔ NGƯỜI DẪN CỦA BUỔI LIVE NÀY LÀ ${gender.toUpperCase()}. Mọi đoạn PHẢI viết người dẫn là ${gender}.
TUYỆT ĐỐI KHÔNG viết người dẫn ${gender === 'nam' ? 'nữ/phụ nữ/cô gái, KHÔNG "cô", KHÔNG tóc đuôi ngựa' : 'nam/đàn ông/anh chàng, KHÔNG "anh"'}.
Dùng đại từ "${gender === 'nam' ? 'anh' : 'cô'}" khi nhắc lại người dẫn trong veoPrompt.

`
    : '';
  return `${genderLock}SÂN KHẤU CỐ ĐỊNH CỦA BUỔI LIVE (đã chốt sẵn cho TOÀN BỘ các sản phẩm trong buổi live này —
KHÔNG được tự nghĩ ra người dẫn/bối cảnh/góc máy/giọng khác, KHÔNG diễn đạt lại khác đi):

- Người dẫn (Subject): ${bible.host}
- Bối cảnh (Scene): ${bible.scene}
- Máy quay (Style): ${bible.camera}
- Chất giọng (Voice): ${bible.voice}
${bible.wardrobeLock ? `- Ràng buộc: ${bible.wardrobeLock}\n` : ''}
BẮT BUỘC: veoPrompt của MỌI đoạn phải chứa NGUYÊN VĂN các cụm mô tả ở trên (copy y hệt,
không paraphrase, không rút gọn, không thêm chi tiết ngoại hình mới). Bỏ qua HOÀN TOÀN yêu cầu tự
chốt người dẫn/bối cảnh/giọng ở BƯỚC 1 của system prompt — BƯỚC 1 KHÔNG áp dụng, sân khấu đã chốt
sẵn ở đây rồi. Sản phẩm trên bàn là thứ DUY NHẤT thay đổi so với các sản phẩm khác trong buổi live.`;
}
