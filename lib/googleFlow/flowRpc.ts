/**
 * 4 RPC batchexecute của Google Flow (upload / gen video / poll / lấy URL).
 *
 * Google gỡ hẳn REST + Bearer (aisandbox-pa.googleapis.com) vào 2026-09; mọi thao tác gen
 * giờ đi qua batchexecute trên chính flow.google.com với payload là MẢNG LỒNG, không phải
 * JSON có tên trường. Toàn bộ chỉ số dưới đây đọc từ HAR gen thật (docs/flow.google.com.har,
 * 2026-09-09) — không có tài liệu nào khác để đối chiếu, nên mỗi hằng số đều ghi rõ nguồn.
 *
 * Auth = cookie + `at` (xem authStore.batchCredsOf). reCAPTCHA token nằm TRONG payload,
 * không phải header như kiến trúc cũ.
 */

import crypto from 'node:crypto';
import { batchExecute } from './client';
import { FlowApiError } from './errors';
import type { FlowBatchCreds } from './authStore';

/** rpcid quan sát được trong HAR. */
export const RPC_UPLOAD_IMAGE = 'maseQ';
export const RPC_GENERATE_VIDEO = 'eb1hJf';
export const RPC_POLL = 'jwpduf';
export const RPC_MEDIA_URL = 'as29s';
/** Danh sách model video tài khoản được cấp quyền. Payload rỗng, gọi rất rẻ. */
export const RPC_AVAILABLE_MODELS = 'yBhWQ';

/**
 * Hằng số `22` ở vị trí [1] của clientContext.
 *
 * Xuất hiện y hệt trong CẢ maseQ lẫn eb1hJf của HAR — nhiều khả năng là mã tool PINHOLE
 * (kiến trúc cũ gửi `tool: 'PINHOLE'` ở đúng vị trí tương ứng). Gửi cố định như trang thật.
 */
const CLIENT_TOOL_CODE = 22;

/**
 * Trạng thái job trong response poll, đọc tại j[5][8] — LƯU Ý: đây là MỘT MẢNG, không phải số.
 *
 * XÁC MINH 2026-09-09 (HAR gen thật docs/flow.google.com.har, 12 lần poll):
 *   j[5][8] = [6]  → vừa nhận, chưa xếp hàng
 *   j[5][8] = [2]  → đang render (giữ suốt 10 lần poll)
 *   j[5][8] = [3]  → xong, as29s bắt đầu trả URL video
 *   j[5][8] = [4, [null,"Media not found."], ["Media not found."]] → lỗi
 *
 * Lỗi cũ đã sửa: code so sánh `state === 3` với chính MẢNG `[3]` → không bao giờ khớp, nên
 * MỌI job đều bị map thành 'running' và chỉ kết thúc bằng timeout. Nay đọc phần tử [0].
 */
const STATE_QUEUED = 6;
const STATE_RUNNING = 2;
const STATE_DONE = 3;

/**
 * State 4 = job lỗi.
 *
 * XÁC MINH 2026-09-09 từ HAR: job 6730c9c7 trả state 4 "Media not found." ở lần poll ĐẦU
 * (5s sau khi gen), rồi lần poll thứ hai đã là [2] và render xong bình thường. Tức state 4
 * kèm "Media not found." NGAY SAU khi gen là race — mediaId ảnh chưa kịp propagate sang
 * backend render, KHÔNG phải job chết.
 *
 * Vì vậy lỗi được chia hai loại (xem TRANSIENT_ERROR_PATTERNS): lỗi tạm thì báo 'running'
 * để vòng poll tiếp tục; lỗi khác báo 'error' ngay như trước.
 *
 * Giữ tinh thần thận trọng cho mã CHƯA biết: chỉ 4 là lỗi, mã lạ khác vẫn coi 'running'.
 */
const STATE_ERROR = 4;

/**
 * Lỗi được coi là TẠM THỜI — poll tiếp thay vì giết job.
 *
 * "Media not found." là trường hợp duy nhất đã quan sát được (bằng chứng ở trên). Không thêm
 * mẫu nào theo suy đoán: coi nhầm một lỗi chết thành tạm thời nghĩa là job treo tới hết
 * timeout, đúng kiểu bug đã tốn nhiều vòng chẩn đoán trước đây.
 */
const TRANSIENT_ERROR_PATTERNS = [/media not found/i];

/**
 * Khoảng thời gian đầu đời của job còn khoan dung với lỗi tạm.
 *
 * 90s: trong HAR lỗi tự khỏi sau 5s (1 vòng poll). Lấy dư rộng vì mạng/tải backend có thể
 * chậm hơn nhiều, mà cái giá của việc chờ thừa chỉ là vài vòng poll — rẻ hơn hẳn so với
 * giết nhầm một job đang render tốt.
 */
export const TRANSIENT_ERROR_GRACE_MS = 90_000;

/** Đường dẫn mảng lồng — tách hằng số để chỗ sửa khi Google đổi layout là DUY NHẤT. */
const PATH_POLL_JOBS = [2] as const;
const PATH_JOB_STATE = [5, 8, 0] as const;
/** Chi tiết lỗi khi state = 4: j[5][8][1] = [code|null, "Mô tả lỗi"] (HAR: [null,"Media not found."]). */
const PATH_JOB_ERROR = [5, 8, 1] as const;
const PATH_MEDIA_IMAGE_URL = [5, 10] as const;
const PATH_MEDIA_VIDEO_URL = [7, 0, 8] as const;
const PATH_UPLOAD_MEDIA_ID = [0, 0] as const;
const PATH_GEN_OPERATIONS = [3] as const;

/** Đọc mảng lồng theo chỉ số, trả null nếu đường dẫn không tồn tại (Google đổi layout). */
function at(root: unknown, path: readonly number[]): unknown {
  let cur: unknown = root;
  for (const i of path) {
    if (!Array.isArray(cur) || cur.length <= i) return null;
    cur = cur[i];
  }
  return cur ?? null;
}

/** UUID hoa — trang thật gửi dạng này ở các trường tracking id. */
function uuidUpper(): string {
  return crypto.randomUUID().toUpperCase();
}

/**
 * clientContext dùng chung cho maseQ và eb1hJf.
 * Vị trí [10] là mảng chứa reCAPTCHA token; các slot null ở giữa là trường trang thật bỏ trống.
 */
function clientContext(projectId: string, recaptchaToken: string): unknown[] {
  return [null, CLIENT_TOOL_CODE, null, null, null, projectId, null, null, null, null, [recaptchaToken, 1]];
}

/** Upload 1 ảnh (base64 nhét thẳng trong payload) → mediaId. */
export async function rpcUploadImage(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  recaptchaToken: string;
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const payload = [
    clientContext(opts.projectId, opts.recaptchaToken),
    opts.bytes.toString('base64'),
    opts.mimeType,
    1,
    null,
    null,
    null,
    null,
    opts.fileName,
    null,
    uuidUpper(),
    uuidUpper(),
  ];
  const res = await batchExecute(RPC_UPLOAD_IMAGE, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    // Ảnh base64 vài MB: 60s mặc định là quá ngắn khi mạng chậm.
    timeoutMs: 180_000,
  });
  const mediaId = at(res, PATH_UPLOAD_MEDIA_ID);
  if (typeof mediaId !== 'string' || !mediaId) {
    throw new FlowApiError(`Upload ảnh (${RPC_UPLOAD_IMAGE}) không trả mediaId. Response: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return mediaId;
}

/** 1 cảnh cần gen — lặp nhiều phần tử trong cùng 1 request để gen nhiều video một lượt. */
export interface VideoScene {
  prompt: string;
  modelKey: string;
  /** mediaId ảnh đầu (i2v). Bỏ trống = text-to-video. */
  startMediaId?: string;
}

function buildScene(scene: VideoScene): unknown[] {
  return [
    [null, null, [[[scene.prompt]]]],
    scene.modelKey,
    1,
    null,
    // [1] = mediaId ảnh đầu; [5] = cặp trọng số ảnh đầu/cuối. HAR gửi cố định cặp
    // [null, 0.000265…, 1, 0.999734…] kể cả khi chỉ có ảnh đầu, nên gửi y nguyên.
    scene.startMediaId
      ? [null, scene.startMediaId, null, null, null, [null, 0.0002656748140276166, 1, 0.9997343251859724]]
      : null,
    [null, null, null, null, uuidUpper(), uuidUpper()],
  ];
}

/**
 * Thông điệp khi eb1hJf không trả operationId.
 *
 * Vì sao cần cả một hàm riêng: Google trả HTTP 200 kèm payload `null` cho MỌI đầu vào bị từ
 * chối, không kèm mã lỗi nào. XÁC MINH 2026-09-11 bằng 3 probe thật trên cùng account đang
 * hoạt động tốt (`at` vừa làm mới 1.8 phút trước):
 *   token reCAPTCHA rỗng, projectId thật  → null
 *   token rác,            projectId thật  → null
 *   token rỗng,           projectId rác   → null
 * Tức `null` KHÔNG phân biệt được nguyên nhân, và thông điệp cũ in ra "Response: null" nên
 * người đọc không biết phải sửa gì. Liệt kê đúng các nguyên nhân đã kiểm chứng, xếp theo xác
 * suất, thay vì đổ lỗi cho một cái.
 *
 * Nguyên nhân áp đảo là reCAPTCHA: token sống ~2 phút và one-time-use (xem recaptcha.ts), nên
 * nó hỏng thường xuyên hơn hẳn projectId — thứ chỉ sai khi project bị xoá phía Google.
 */
function describeEmptyGenResponse(res: unknown): string {
  return (
    `Gen video (${RPC_GENERATE_VIDEO}) bị Google từ chối: trả về rỗng, không có operationId. ` +
    `Google dùng CÙNG một response rỗng cho mọi lý do nên không tự phân biệt được; ` +
    `theo thứ tự hay gặp: (1) token reCAPTCHA hết hạn/đã dùng — token chỉ sống ~2 phút và ` +
    `dùng một lần, hãy mở sẵn tab https://flow.google.com đã đăng nhập để extension mint kịp; ` +
    `(2) Flow project không còn tồn tại phía Google; (3) model key không được cấp cho tài ` +
    `khoản này. Response thô: ${JSON.stringify(res).slice(0, 200)}`
  );
}

/** Gen video → danh sách operationId (1 phần tử cho mỗi scene gửi lên). */
export async function rpcGenerateVideo(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  recaptchaToken: string;
  scenes: VideoScene[];
}): Promise<string[]> {
  if (opts.scenes.length === 0) throw new FlowApiError('rpcGenerateVideo: không có scene nào để gen');

  const payload = [
    opts.scenes.map(buildScene),
    clientContext(opts.projectId, opts.recaptchaToken),
    // [<uuid>, 2] — batch id của lần bấm gen, trang thật gửi kèm hằng 2.
    [uuidUpper(), 2],
  ];
  const res = await batchExecute(RPC_GENERATE_VIDEO, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 120_000,
  });

  const ops = at(res, PATH_GEN_OPERATIONS);
  const ids = Array.isArray(ops)
    ? ops.map((job) => (Array.isArray(job) && typeof job[0] === 'string' ? job[0] : null)).filter((x): x is string => !!x)
    : [];
  if (ids.length === 0) {
    throw new FlowApiError(describeEmptyGenResponse(res));
  }
  return ids;
}

/**
 * Model video tài khoản này được Google cấp quyền.
 *
 * XÁC MINH 2026-09-11 (docs/create-project-flow.google.com.har): payload `[]`, response
 * `[[["veo_3_1_quality",1],["veo_3_1_lite_low_priority",1],["veo_3_1_fast",1],["abra",1],
 * ["veo_3_1_lite",1]]]` — mảng cặp [tên model, cờ]. Đây là danh sách TIER (veo_3_1_lite,
 * abra…), KHÔNG phải videoModelKey đầy đủ (veo_3_1_i2v_lite_8s) mà lệnh gen gửi đi; dùng để
 * kiểm tier trước khi gen, không dùng để dựng key.
 */
export async function rpcAvailableModels(creds: FlowBatchCreds, projectId: string): Promise<string[]> {
  const res = await batchExecute(RPC_AVAILABLE_MODELS, [], {
    creds,
    sourcePath: `/project/${projectId}`,
    timeoutMs: 30_000,
  });
  const rows = at(res, [0]);
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (Array.isArray(row) ? row[0] : null))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

export type FlowJobState = 'running' | 'done' | 'error';

export interface FlowJobStatus {
  state: FlowJobState;
  /** Mô tả lỗi Google trả kèm state 4, vd "Media not found.". Null khi không có lỗi. */
  error: string | null;
  /** true khi lỗi thuộc nhóm tạm thời (xem TRANSIENT_ERROR_PATTERNS) — caller được phép chờ thêm. */
  transient: boolean;
}

/**
 * Poll nhiều operationId cùng lúc → map id → trạng thái.
 *
 * Payload: `[null, null, [[id1],[id2],…]]` — mỗi id nằm trong MẢNG RIÊNG. XÁC MINH từ HAR
 * 2026-09-09: trang thật gửi `[["1e583222-…"],["6730c9c7-…"]]` cho 2 job. Code cũ gửi
 * `[[id1,id2]]` (một mảng chứa mọi id) — trùng khớp tình cờ khi chỉ có 1 job, nên bug ẩn
 * cho tới khi poll nhiều job một lượt.
 */
function buildPollPayload(operationIds: string[]): unknown[] {
  return [null, null, operationIds.map((id) => [id])];
}

export async function rpcPollJobs(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  operationIds: string[];
}): Promise<Record<string, FlowJobStatus>> {
  const payload = buildPollPayload(opts.operationIds);
  const res = await batchExecute(RPC_POLL, payload, {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 30_000,
  });

  const jobs = at(res, PATH_POLL_JOBS);
  const out: Record<string, FlowJobStatus> = {};
  if (Array.isArray(jobs)) {
    for (const job of jobs) {
      const id = Array.isArray(job) ? job[0] : null;
      if (typeof id !== 'string') continue;
      out[id] = jobStatusOf(job);
    }
  }
  return out;
}

/** Đọc state + lý do lỗi của 1 job trong response poll. */
export function jobStatusOf(job: unknown): FlowJobStatus {
  const state = mapJobState(at(job, PATH_JOB_STATE));
  if (state !== 'error') return { state, error: null, transient: false };
  const error = jobErrorReason(job);
  const transient = !!error && TRANSIENT_ERROR_PATTERNS.some((re) => re.test(error));
  return { state, error, transient };
}

/**
 * Map state → trạng thái. Mã lạ (không phải 3/4) vẫn coi là đang chạy — xem STATE_ERROR.
 *
 * Nhận CẢ số lẻ lẫn mảng `[n, …]`: HAR cho thấy Google gửi mảng, nhưng chấp nhận số trần
 * để không vỡ nếu Google đổi lại — rẻ hơn nhiều so với một lần chẩn đoán "job nào cũng
 * running" như bug vừa sửa.
 */
function mapJobState(raw: unknown): FlowJobState {
  const state = Array.isArray(raw) ? raw[0] : raw;
  if (state === STATE_DONE) return 'done';
  if (state === STATE_ERROR) return 'error';
  return 'running';
}

/** Lý do lỗi Google trả kèm state 4, vd "Media not found.". Null nếu không đọc được. */
export function jobErrorReason(job: unknown): string | null {
  const err = at(job, PATH_JOB_ERROR);
  if (Array.isArray(err)) {
    const name = err.find((x) => typeof x === 'string');
    if (typeof name === 'string') return name;
  }
  return typeof err === 'string' ? err : null;
}

/**
 * Lấy signed CDN URL của media (dùng chung cho cả ảnh lẫn video — cùng 1 rpcid).
 *
 * URL có `Expires` ~6 giờ nên phải tải ngay, không cache lâu.
 */
export async function rpcMediaUrl(opts: {
  creds: FlowBatchCreds;
  projectId: string;
  mediaId: string;
}): Promise<{ imageUrl: string | null; videoUrl: string | null }> {
  const res = await batchExecute(RPC_MEDIA_URL, [opts.mediaId], {
    creds: opts.creds,
    sourcePath: `/project/${opts.projectId}`,
    timeoutMs: 30_000,
  });
  const pick = (path: readonly number[]): string | null => {
    const v = at(res, path);
    return typeof v === 'string' && v.startsWith('http') ? v : null;
  };
  return { imageUrl: pick(PATH_MEDIA_IMAGE_URL), videoUrl: pick(PATH_MEDIA_VIDEO_URL) };
}

/** Chỉ dùng cho scripts/check-flow-rpc.ts. */
export const __testables = {
  at,
  buildScene,
  clientContext,
  describeEmptyGenResponse,
  mapJobState,
  jobStatusOf,
  buildPollPayload,
  STATE_QUEUED,
  STATE_RUNNING,
  STATE_DONE,
  STATE_ERROR,
};
