/**
 * Sinh video Google Flow qua RPC batchexecute `eb1hJf` + poll `jwpduf` (xem flowRpc.ts).
 *
 * 2026-09: Google gỡ hẳn REST batchAsyncGenerateVideo* trên aisandbox-pa.googleapis.com.
 * Logic dựng videoModelKey bên dưới GIỮ NGUYÊN — HAR gen thật (2026-09-08) cho thấy tên key
 * không đổi (`veo_3_1_i2v_lite_low_priority`, `abra_i2v_8s` đều khớp quy tắc cũ); chỉ tầng
 * vận chuyển đổi. aspect/seed không còn chỗ trong payload batchexecute mới (trang thật không
 * gửi) nên bị bỏ qua — xem ghi chú tại generateVideo.
 */

import { RECAPTCHA_ACTION_VIDEO } from './client';
import { acquireRecaptchaToken } from './recaptcha';
import { uploadImageFile } from './upload';
import { rpcGenerateVideo, rpcPollJobs, TRANSIENT_ERROR_GRACE_MS } from './flowRpc';
import { FlowApiError } from './errors';
import type { FlowBatchCreds } from './authStore';
import type { VeoModel } from '../types';

export type VideoAspect = '16:9' | '9:16';

const VIDEO_ASPECT_MAP: Record<VideoAspect, string> = {
  '16:9': 'VIDEO_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'VIDEO_ASPECT_RATIO_PORTRAIT',
};

export type VideoMode = 't2v' | 'i2v_s' | 'i2v_se' | 'r2v' | 'edit';

interface CoreParts {
  base: string;
  suffix: string;
}

function coreParts(model: VeoModel): CoreParts {
  switch (model) {
    case 'veo_3_1_quality':
      return { base: 'quality', suffix: '' };
    case 'veo_3_1_fast':
      return { base: 'fast', suffix: '' };
    case 'veo_3_1_lite':
      return { base: 'lite', suffix: '' };
    case 'veo_3_1_lite_low_priority':
      return { base: 'lite', suffix: '_low_priority' };
    case 'abra':
      return { base: 'abra', suffix: '' };
  }
}

/** duration 8s là mặc định → bỏ hậu tố; 4/6/10s thêm _Ns. */
function durationSuffix(duration: number): string {
  return duration === 8 ? '' : `_${duration}s`;
}

/**
 * Dùng tier `lite_low_priority` cho mode r2v (thay vì `lite` thường).
 *
 * Đổi về false nếu Google thu lại quyền tier này (403 PUBLIC_ERROR_MODEL_ACCESS_DENIED) — 403
 * không được thử biến thể khác nên sẽ giết cả lần gen, phải sửa tay tại đây.
 * Đặt env FLOW_R2V_LOW_PRIORITY=false để tắt nhanh trên production mà không cần deploy.
 */
const R2V_USE_LOW_PRIORITY = (process.env.FLOW_R2V_LOW_PRIORITY ?? 'true').toLowerCase() !== 'false';

/**
 * Dựng videoModelKey (best-effort, reverse-engineered — xem GoogleFlow.postman_collection.json).
 * - core tier: quality/fast/lite/lite_low_priority/abra.
 * - mode infix: t2v (text), i2v_s (start image), i2v_se (start+end, thêm _fl), r2v (reference),
 *   edit (abra edit).
 * - Có thể override toàn bộ qua env FLOW_VIDEO_MODEL_KEY_OVERRIDE khi key thực tế khác.
 */
export function resolveVideoModelKey(
  model: VeoModel,
  mode: VideoMode,
  duration: number,
  useFl: boolean
): string {
  const override = process.env.FLOW_VIDEO_MODEL_KEY_OVERRIDE;
  if (override && override.trim()) return override.trim();

  if (model === 'abra') {
    // Omni Flash: key đơn giản `abra_<mode>`, edit dùng `abra_edit` (xác minh trong collection).
    if (mode === 'edit') return 'abra_edit';
    // XÁC MINH 2026-09-11 từ HAR gen THẬT (docs/create-project-flow.google.com.har): trang Flow
    // gửi `abra_i2v_8s` cho một lần gen có ảnh đầu, duration 8s. Hai điểm lệch với quy tắc cũ:
    //   1. mode `i2v_s` phải RÚT GỌN thành `i2v` (giống tier lite của nhánh veo_3_1 bên dưới);
    //      key cũ sinh `abra_i2v_s` — không tồn tại.
    //   2. abra LUÔN kèm hậu tố duration, kể cả 8s. durationSuffix() bỏ hậu tố ở 8s theo quy
    //      tắc của veo_3_1, áp cho abra là sinh `abra_i2v` — cũng không tồn tại.
    // Cả hai đều khiến Google trả response RỖNG (không mã lỗi), triệu chứng giống hệt token
    // reCAPTCHA hỏng nên rất dễ chẩn đoán nhầm.
    // r2v gộp luôn vào i2v: batchexecute chỉ có MỘT slot ảnh (startMediaId), không phân biệt
    // r2v với i2v — cùng lý do đã xác minh cho nhánh veo_3_1 bên dưới, key `*_r2v_*` là di sản
    // của kiến trúc REST cũ Google đã gỡ.
    const abraMode = mode === 'i2v_se' || mode === 'i2v_s' || mode === 'r2v' ? 'i2v' : mode;
    return `abra_${abraMode}_${duration}s${useFl ? '_fl' : ''}`;
  }

  // Mode reference-to-video (r2v — @Characters/ảnh người mẫu) luôn bị ép về tier lite bất kể
  // model job chọn (tier fast/quality trả 404).
  //
  // Dùng `_low_priority`: XÁC MINH THỰC NGHIỆM 2026-08-26 — gen thật qua production, Google chấp
  // nhận `veo_3_1_r2v_lite_low_priority` và render xong bình thường. Ghi chú cũ (2026-08-25) nói
  // tier này trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED đã KHÔNG còn đúng: quyền tài khoản đổi theo
  // thời gian, nên đây là điều cần đo lại chứ không phải hằng số.
  //
  // Vì sao chọn low_priority: nó tiêu tốn quota chậm hơn tier lite thường — với job livestream
  // hàng chục đoạn thì đây là khác biệt giữa chạy hết block và cụt giữa chừng vì hết quota.
  // Đánh đổi: hàng đợi ưu tiên thấp nên thời gian chờ render có thể lâu hơn.
  //
  // Nếu Google thu lại quyền (403 trở lại), đổi cờ này về false là quay lại hành vi cũ ngay;
  // 403 KHÔNG được fallback tự động (xem modelKeyCandidates) nên phải sửa ở đây.
  // Mode r2v KHÔNG có key riêng trong kiến trúc batchexecute.
  //
  // XÁC MINH 2026-09-09 (bằng chứng, không phải suy đoán):
  //   - Quét toàn bộ HAR gen thật: chỉ có `veo_3_1_i2v_lite_low_priority` và `abra_i2v_8s`.
  //     KHÔNG có bất kỳ key nào chứa 'r2v'.
  //   - Gen qua app với key `veo_3_1_r2v_lite_low_priority` → Google trả state 4 kèm
  //     "Media not found." / NOT_FOUND, lặp 17 lần không ra video nào.
  //   - Cùng prompt + ảnh ref tạo TAY trên giao diện Flow thì chạy bình thường.
  //
  // Lý do khớp với cấu trúc payload: buildScene chỉ có MỘT chỗ cho ảnh (`startMediaId`) —
  // batchexecute không phân biệt r2v với i2v, ảnh ref đi vào đúng slot ảnh đầu. Key
  // `veo_3_1_r2v_*` là di sản của kiến trúc REST cũ (aisandbox-pa) mà Google đã gỡ.
  //
  // Vẫn giữ tier lite_low_priority: đó chính là tier trang thật dùng, và nó tiêu quota chậm
  // hơn — quan trọng với job livestream hàng chục đoạn.
  if (mode === 'r2v') {
    const tier = R2V_USE_LOW_PRIORITY ? 'lite_low_priority' : 'lite';
    return `veo_3_1_i2v_${tier}${durationSuffix(duration)}`;
  }

  const { base, suffix } = coreParts(model);
  // Tier lite dùng tên mode RÚT GỌN `i2v` (không có `_s`) — XÁC MINH hai nguồn độc lập:
  //   - thực nghiệm 2026-08-25: `veo_3_1_i2v_s_lite` và `_fl` đều 404, `veo_3_1_i2v_lite` chạy;
  //   - HAR gen thật 2026-09-11: trang Flow gửi đúng `veo_3_1_i2v_lite_low_priority`.
  // fast/quality vẫn dùng dạng dài `i2v_s`. Trước đây quy tắc này chỉ nằm trong
  // modelKeyCandidates (fallback), mà fallback thì lại là code chết — nên mọi lần gen ở tier
  // lite kèm ảnh đầu đều gửi key không tồn tại và bị Google từ chối bằng response RỖNG.
  const shortI2v = base === 'lite';
  const modeInfix =
    (mode === 'i2v_se' || mode === 'i2v_s') && shortI2v ? 'i2v' : mode === 'i2v_se' ? 'i2v_s' : mode;
  return `veo_3_1_${modeInfix}_${base}${durationSuffix(duration)}${suffix}${useFl ? '_fl' : ''}`;
}

/** 1 ảnh reference kèm mediaId Flow đã biết (cache) — bỏ trống nếu chưa từng upload. */
export interface RefImageInput {
  path: string;
  mediaId?: string;
}

export interface GenerateVideoParams {
  creds: FlowBatchCreds;
  /** Token reCAPTCHA đã mint sẵn — dùng cho cả upload ảnh lẫn lệnh gen trong cùng lần gọi. */
  recaptchaToken: string;
  prompt: string;
  aspect: VideoAspect;
  model: VeoModel;
  projectId: string;
  duration: number;
  refImages?: RefImageInput[];
  startImage?: RefImageInput;
  endImage?: RefImageInput;
  /** Seed cố định (VD dùng chung cả job) — nếu bỏ trống, random như trước. */
  seed?: number;
}

export interface GenerateVideoResult {
  job_id: string;
  /** mediaId của các ảnh vừa upload MỚI (chưa có trong cache) — caller lưu lại để tái dùng lần sau. */
  uploadedMediaIds: Record<string, string>;
  /** Model key THỰC SỰ được Google chấp nhận (có thể là biến thể fallback, không phải key gốc). */
  modelKey?: string;
  /**
   * Prompt CUỐI CÙNG đã gửi cho Google — sau khi ghép lời thoại Việt, chặn phụ đề và nối negative.
   *
   * Vì sao trả ra ngoài: caller chỉ có scene.veoPrompt THÔ. Ghi bản thô vào log rồi soát prompt
   * trên đó là soát nhầm thứ — đúng bài học doc-comment ai_call_logs đã ghi cho system_prompt
   * ("bản dựng lại luôn lệch với thứ thật").
   */
  finalPrompt?: string;
}

/** Trả mediaId có sẵn nếu đã cache, ngược lại upload rồi ghi nhận vào `uploaded`. */
async function resolveMediaId(
  params: GenerateVideoParams,
  projectId: string,
  ref: RefImageInput,
  uploaded: Record<string, string>
): Promise<string> {
  if (ref.mediaId) return ref.mediaId;
  const mediaId = await uploadImageFile(params.creds, projectId, params.recaptchaToken, ref.path);
  uploaded[ref.path] = mediaId;
  return mediaId;
}

/**
 * Sinh video.
 *
 * Mode vẫn quyết định videoModelKey y như trước (r2v/i2v_se/i2v_s/t2v), nhưng payload
 * batchexecute chỉ có MỘT chỗ cho ảnh: `startMediaId`. Trang thật không gửi ảnh cuối,
 * aspect hay seed trong lần gen i2v nào của HAR — nên:
 *   - ảnh ref / ảnh đầu → startMediaId (ref đầu tiên được dùng),
 *   - ảnh cuối, aspect, seed: KHÔNG gửi. Bỏ qua có chủ đích, không phải quên. Muốn khôi
 *     phục thì cần HAR có thao tác tương ứng để biết Google đặt chúng ở chỉ số nào —
 *     đoán vị trí trong mảng lồng là cách nhanh nhất để Google trả lỗi khó hiểu.
 */
export async function generateVideo(params: GenerateVideoParams): Promise<GenerateVideoResult> {
  const hasRef = !!params.refImages && params.refImages.length > 0;
  const hasStart = !!params.startImage;
  const hasEnd = !!params.endImage;
  const uploadedMediaIds: Record<string, string> = {};

  let mode: VideoMode;
  let startMediaId: string | undefined;

  if (hasRef) {
    mode = 'r2v';
    startMediaId = await resolveMediaId(params, params.projectId, params.refImages![0], uploadedMediaIds);
  } else if (hasStart && hasEnd) {
    mode = 'i2v_se';
    startMediaId = await resolveMediaId(params, params.projectId, params.startImage!, uploadedMediaIds);
  } else if (hasStart) {
    mode = 'i2v_s';
    startMediaId = await resolveMediaId(params, params.projectId, params.startImage!, uploadedMediaIds);
  } else {
    mode = 't2v';
  }

  const baseKey = resolveVideoModelKey(params.model, mode, params.duration, mode === 'i2v_se');

  // Thử lần lượt các biến thể key khi Google TỪ CHỐI vì key không tồn tại.
  //
  // Vì sao bây giờ mới nối: modelKeyCandidates() nằm chết từ khi port sang batchexecute (ghi
  // rõ trong chính docstring của nó), nên sự cố 2026-09-09 — key r2v sai, Google trả lỗi 17
  // lần — không có gì chặn. videoModelKey là chuỗi reverse-engineered, Google KHÔNG công bố
  // danh sách hợp lệ, nên sai key là chuyện sẽ còn xảy ra mỗi lần họ đổi tên.
  //
  // CHỈ thử tiếp khi lỗi là "key không hợp lệ" (response rỗng / 404). 403
  // PUBLIC_ERROR_MODEL_ACCESS_DENIED nghĩa là key ĐÚNG nhưng tài khoản không có quyền — thử
  // biến thể khác chỉ tốn thêm request, và mỗi lần gửi là một lần tiêu reCAPTCHA token.
  const candidates = modelKeyCandidates(baseKey);
  let lastErr: unknown = null;

  for (const [i, modelKey] of candidates.entries()) {
    try {
      const ids = await rpcGenerateVideo({
        creds: params.creds,
        projectId: params.projectId,
        recaptchaToken: params.recaptchaToken,
        scenes: [{ prompt: params.prompt, modelKey, startMediaId }],
      });
      if (i > 0) {
        console.warn(
          `[flow gen] model key "${baseKey}" bị từ chối, dùng được biến thể "${modelKey}" ` +
            `(thử ${i + 1}/${candidates.length}). Cân nhắc sửa resolveVideoModelKey cho khớp.`
        );
      }
      return { job_id: ids[0], uploadedMediaIds, modelKey };
    } catch (err) {
      lastErr = err;
      if (!isInvalidModelKeyError(err)) throw err;
      console.warn(
        `[flow gen] model key "${modelKey}" bị từ chối (${i + 1}/${candidates.length})` +
          `${i + 1 < candidates.length ? ' — thử biến thể kế' : ''}`
      );
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new FlowApiError(`Không model key nào dùng được: đã thử ${candidates.join(', ')}`);
}

/**
 * Lỗi này có phải "model key không tồn tại" không — tức có đáng thử biến thể khác.
 *
 * Response RỖNG là ứng viên chính: XÁC MINH 2026-09-11 bằng probe thật, Google trả HTTP 200 +
 * payload `null` cho mọi đầu vào bị từ chối, không kèm mã lỗi. Nên key sai và token hỏng nhìn
 * giống hệt nhau từ ngoài — thử biến thể key là cách rẻ nhất để loại trừ một trong hai.
 *
 * 403 (ACCESS_DENIED) KHÔNG tính: key đúng, tài khoản thiếu quyền — thử tiếp vô ích.
 */
function isInvalidModelKeyError(err: unknown): boolean {
  if (!(err instanceof FlowApiError)) return false;
  if (err.code === 403) return false;
  if (err.code === 404) return true;
  return /trả về rỗng, không có operationId/.test(err.message);
}

/**
 * ĐÃ ĐƯỢC NỐI VÀO generateVideo() từ 2026-09-11 (trước đó là code chết suốt từ lúc port sang
 * batchexecute — sự cố 2026-09-09 key r2v sai, Google từ chối 17 lần, không gì chặn).
 *
 * Các biến thể videoModelKey để thử khi Google trả 404 cho key dựng theo quy tắc.
 *
 * Vì sao cần: videoModelKey là chuỗi reverse-engineered — Google KHÔNG công bố danh sách key
 * hợp lệ, và không phải tổ hợp (mode × tier) nào cũng tồn tại. Key không tồn tại trả về
 * 404 NOT_FOUND giống hệt lỗi "project entity không tồn tại", nên rất dễ chẩn đoán nhầm.
 * Tiền lệ đã biết: r2v CHỈ có tier lite (xem resolveVideoModelKey).
 *
 * Chỉ sinh biến thể ĐỔI DẠNG HẬU TỐ, giữ nguyên tier của người dùng — không tự hạ/nâng tier
 * vì tier quyết định chi phí và chất lượng, đổi ngầm là vượt quyền quyết định của người dùng.
 */
function modelKeyCandidates(baseKey: string): string[] {
  const out = [baseKey];
  // Biến thể `_fl` ("first+last"): collection có veo_3_1_i2v_s_lite_6s_fl.
  if (!baseKey.endsWith('_fl')) out.push(`${baseKey}_fl`);
  // i2v_s + lite: XÁC MINH THỰC NGHIỆM (2026-08-25) — `veo_3_1_i2v_s_lite` và
  // `veo_3_1_i2v_s_lite_fl` đều trả 404; key dùng được là `veo_3_1_i2v_lite`, tức tier lite
  // dùng tên mode RÚT GỌN `i2v` (không có `_s`) trong khi fast/quality dùng `i2v_s`.
  if (baseKey.includes('_i2v_s_')) {
    const short = baseKey.replace('_i2v_s_', '_i2v_');
    out.push(short, `${short}_fl`);
  }
  // Nhánh abra (Omni Flash): HAR 2026-09-11 cho thấy key thật là `abra_i2v_8s` — mode rút gọn
  // + LUÔN có hậu tố duration. resolveVideoModelKey đã sinh đúng dạng đó, nhưng nếu Google đổi
  // lại quy ước thì hai biến thể dưới đây là ứng viên gần nhất: bỏ hậu tố duration, và giữ
  // dạng mode dài `i2v_s`.
  if (baseKey.startsWith('abra_')) {
    const noDuration = baseKey.replace(/_\d+s$/, '');
    if (noDuration !== baseKey) out.push(noDuration);
    if (baseKey.includes('abra_i2v_')) out.push(baseKey.replace('abra_i2v_', 'abra_i2v_s_'));
  }
  // KHÔNG thêm biến thể `_low_priority`: tier này tài khoản thường không được cấp quyền →
  // Google trả 403 PUBLIC_ERROR_MODEL_ACCESS_DENIED (xác minh 2026-08-25). 403 khác 404 ở chỗ
  // nó KHÔNG được thử tiếp, nên một ứng viên 403 lọt vào danh sách sẽ giết cả lần gen.
  return Array.from(new Set(out));
}

export type VideoPollState = 'pending' | 'running' | 'done' | 'error';

export interface VideoPollResult {
  status: VideoPollState;
  phase?: string;
  error?: string;
}

/**
 * Poll trạng thái 1 job đang gen video.
 *
 * CẬP NHẬT 2026-09-09 (đọc từ HAR gen thật, không suy đoán):
 *   - state nằm trong MẢNG j[5][8] (`[2]`/`[3]`/`[4,…]`), trước đây so sánh với số trần nên
 *     không bao giờ khớp → job nào cũng 'running' tới hết timeout. Đã sửa trong flowRpc.
 *   - state 4 kèm "Media not found." xuất hiện ở lần poll ĐẦU rồi tự khỏi ở lần thứ hai
 *     (mediaId ảnh chưa propagate). Nên job còn trẻ hơn TRANSIENT_ERROR_GRACE_MS thì lỗi tạm
 *     được báo 'running' để vòng poll tiếp tục; quá ngưỡng mới coi là lỗi thật.
 *
 * `jobAgeMs` = job đã chạy bao lâu. Không truyền → không khoan dung (lỗi tạm bị coi là lỗi
 * thật ngay), giữ hành vi cũ cho caller không biết mốc bắt đầu.
 */
export async function pollVideoStatus(
  creds: FlowBatchCreds,
  projectId: string,
  jobId: string,
  jobAgeMs = Number.POSITIVE_INFINITY
): Promise<VideoPollResult> {
  const statuses = await rpcPollJobs({ creds, projectId, operationIds: [jobId] });
  const st = statuses[jobId];
  if (!st) {
    throw new FlowApiError(`Poll không trả trạng thái cho job ${jobId} (job không thuộc project ${projectId}?)`);
  }
  if (st.state === 'error') {
    if (st.transient && jobAgeMs <= TRANSIENT_ERROR_GRACE_MS) {
      // Log đủ số liệu để lần sau điều tra được bằng dữ liệu: lỗi gì, job bao nhiêu tuổi, ngưỡng nào.
      console.warn(
        `[flow poll] job ${jobId}: Google báo lỗi TẠM THỜI "${st.error}" khi job mới ` +
          `${Math.round(jobAgeMs / 1000)}s tuổi (ngưỡng ${TRANSIENT_ERROR_GRACE_MS / 1000}s) → ` +
          'coi là đang chạy, poll tiếp'
      );
      return { status: 'running', phase: 'transient-error' };
    }
    const reason = st.error ? `Google báo job lỗi: ${st.error}` : 'Google báo job lỗi (state 4)';
    return { status: 'error', phase: 'error', error: reason };
  }
  return { status: st.state === 'done' ? 'done' : 'running', phase: st.state };
}

/** Chỉ dùng cho scripts/check-model-key.ts — không import ở code chạy thật. */
export const __testables = { modelKeyCandidates };
