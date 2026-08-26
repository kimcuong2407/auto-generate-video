import type { ConcatState, ConcatStatus, FlowStatusCache, VeoModel } from '../types';

export type IngestStatus = 'pending' | 'fetched' | 'needs_manual' | 'ready' | 'failed';
export type SegmentStatus = 'idle' | 'generating' | 'done' | 'failed';
export type ScriptStatus = 'idle' | 'generating' | 'done' | 'failed';
export type LivestreamChaining = 'off' | 'per_product' | 'continuous';

export interface LivestreamSegment {
  id: string;
  /** Thứ tự tuyệt đối trong TOÀN BỘ job (xuyên suốt nhiều sản phẩm) — dùng để concat đúng thứ tự. */
  order: number;
  voiceoverVi: string;
  veoPrompt: string;
  /** Giây, đã clamp theo giới hạn Veo thật (4-10s tuỳ model). */
  duration: number;
  status: SegmentStatus;
  jobId: string | null;
  /** Đường dẫn tương đối trong job dir, VD "outputs/segments/003_seg-03.mp4". */
  videoPath: string | null;
  /**
   * URL public trên Cloudflare R2 sau khi upload — dùng để preview/tải online không phụ thuộc
   * route stream file local (quan trọng khi deploy Ubuntu: file segment local bị xoá sau concat).
   * null nếu R2 chưa cấu hình hoặc upload thất bại (fallback về route media local khi còn file).
   */
  videoUrl: string | null;
  /** Đường dẫn tương đối khung hình cuối đã extract, dùng làm start_path cho đoạn kế (chaining). */
  lastFramePath: string | null;
  error: string | null;
  attempts: number;
  lastUpdatedAt: string | null;
}

export type ProductSourceType = 'link' | 'file_text' | 'file_image' | 'manual';

export interface LivestreamProduct {
  id: string;
  order: number;
  sourceType: ProductSourceType;
  sourceLink: string | null;
  /** Đường dẫn tương đối file gốc đã upload (ảnh/text), null nếu nguồn là link/manual. */
  sourceFilePath: string | null;
  /** Text thô trích được từ file/link/manual input, dùng làm input cho AI tách/viết script. */
  rawText: string | null;
  ingestStatus: IngestStatus;
  ingestError: string | null;
  name: string;
  description: string;
  targetDurationSec: number;
  scriptStatus: ScriptStatus;
  scriptError: string | null;
  segments: LivestreamSegment[];
}

export type LivestreamJobStatus =
  | 'draft'
  | 'scripting'
  | 'generating'
  | 'concatenating'
  | 'done'
  | 'failed';

/**
 * "Sân khấu" CỐ ĐỊNH của cả buổi live — chốt 1 lần ở cấp job rồi ép dùng lại y nguyên khi sinh
 * script cho MỌI sản phẩm, để nhiều sản phẩm khác nhau vẫn ra 1 buổi live thống nhất (cùng người
 * dẫn, cùng phòng, cùng góc máy, cùng giọng). Các field là cụm mô tả TIẾNG ANH dùng thẳng trong
 * veoPrompt. Xem lib/livestream/stageBible.ts.
 */
export interface LivestreamStageBible {
  host: string;
  scene: string;
  camera: string;
  voice: string;
  wardrobeLock: string;
  /**
   * Ảnh mẫu (selectedModelImagePath) đã dùng để chốt bible này — dấu vết để biết bible còn khớp
   * input hay không. Ảnh mẫu hiện tại khác giá trị này (VD chốt khi chưa có ảnh, sau đó mới upload
   * ảnh người dẫn nam) → bible tả sai người, phải chốt lại; xem ensureStageBible().
   * undefined = bible chốt bởi bản code cũ (chưa ghi dấu vết) → coi như không khớp, chốt lại 1 lần.
   */
  modelImagePath?: string | null;
}

export interface LivestreamJob {
  /** Định danh public (URL, route param) — luôn bằng `slug`. PK bigint thật chỉ dùng nội bộ DB layer. */
  id: string;
  /** Slug dùng làm tên thư mục filesystem (data/livestream/{slug}/) và R2 object key. */
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  aspectRatio: '9:16' | '16:9';
  veoModel: VeoModel;
  chaining: LivestreamChaining;
  status: LivestreamJobStatus;
  products: LivestreamProduct[];
  /**
   * KHO ảnh sản phẩm CHUNG cả job (crawl/upload) — mảng đường dẫn tương đối, rỗng nếu không dùng.
   * Người dùng chọn 1 hoặc nhiều ảnh trong kho này làm ref qua `selectedRefImagePaths`, áp cho MỌI
   * segment của MỌI sản phẩm trong job (1 buổi live thường 1 bối cảnh/1 người dẫn nhất quán).
   */
  spokespersonImagePaths: string[];
  /**
   * Đường dẫn tương đối các ảnh sản phẩm ĐƯỢC CHỌN làm reference (bắt buộc chọn ít nhất 1 ảnh ở đầu
   * trang mới gen được nếu kho ảnh không rỗng). Mỗi phần tử phải nằm trong `spokespersonImagePaths`.
   * Dùng làm refPaths (r2v, IMAGE_USAGE_TYPE_ASSET) — ref luôn ưu tiên hơn frame-chaining để giữ
   * sản phẩm nhất quán xuyên suốt, xem lib/livestream/segmentGenerate.ts.
   */
  selectedRefImagePaths: string[];
  /**
   * Đường dẫn tương đối ảnh MẪU/NGƯỜI DẪN riêng (upload tay), tuỳ chọn — 1 ảnh duy nhất áp cho
   * MỌI segment của MỌI sản phẩm, truyền kèm ảnh sản phẩm + background làm refPaths (r2v) khi gen
   * video. Tách biệt kho ảnh sản phẩm (spokespersonImagePaths). null = không dùng.
   */
  selectedModelImagePath: string | null;
  /** KHO ảnh background (bối cảnh) chung cả job — mảng đường dẫn tương đối, rỗng nếu không dùng. */
  backgroundImagePaths: string[];
  /**
   * Ảnh background ĐƯỢC CHỌN (tuỳ chọn) — phải nằm trong `backgroundImagePaths`, null = không dùng.
   * Nếu có, truyền kèm ảnh sản phẩm làm ref khi gen (r2v cho phép nhiều referenceImages).
   */
  selectedBackgroundImagePath: string | null;
  /** Model ảnh dùng khi gen background bằng AI (xem lib/livestream/backgroundGenerate.ts) — 'chatgpt-web/gpt-5.5' (OmniRoute) hoặc 'flow-image' (Google Flow/Veo). */
  backgroundModel: string;
  /**
   * URL R2 (bản sao bền vững) của các ảnh input — key = relPath đang có trong 5 field ảnh trên
   * (vd 'inputs/spokesperson-...jpg'), value = URL public R2 hoặc null (chỉ có local / R2 tắt).
   * UI ưu tiên URL R2 khi hiển thị; khi gen video/background, nếu file local mất sẽ tải lại từ URL
   * này về local (xem lib/livestream/imageR2.ts). Chỉ áp cho ảnh MỚI upload/gen — ảnh cũ giữ local.
   */
  imageR2Urls: Record<string, string | null>;
  /**
   * Cache mediaId Flow đã upload cho từng ảnh (key = relPath, value = mediaId) — tránh upload lại
   * cùng 1 ảnh nhiều lần lên Flow project (gây rác data). Chỉ hợp lệ trong đúng `flowProjectId` đã
   * upload — bị clear khi flowProjectId đổi, xem ensureJobFlowId ở jobStore.ts.
   */
  flowMediaIds: Record<string, string>;
  concat: ConcatState;
  flowStatusCache: FlowStatusCache;
  flowProjectId: string | null;
  /**
   * System prompt sinh kịch bản do người dùng chỉnh cho job này. null = dùng
   * LIVESTREAM_SYSTEM_PROMPT mặc định (xem resolveScriptSystemPrompt ở scriptPrompt.ts).
   * Chỉ override prompt sinh kịch bản; prompt extract/vision không cho override (chỉ read-only ở UI).
   */
  scriptSystemPromptOverride: string | null;
  /**
   * Sân khấu cố định dùng chung mọi sản phẩm (xem LivestreamStageBible). null = chưa sinh, sẽ
   * được lazy-tạo ở lần sinh script đầu tiên rồi giữ nguyên để các lần sinh lại vẫn khớp.
   */
  stageBible: LivestreamStageBible | null;

  /**
   * Seed cố định dùng chung cho MỌI lần gen video của job (thay vì random mỗi đoạn) — giúp Veo ổn
   * định hơn giữa các đoạn (hình lẫn giọng), xem ensureJobVideoSeed ở jobStore.ts. null = chưa gen
   * video lần nào, sẽ được lazy-tạo ở lần gen đầu tiên rồi giữ nguyên suốt vòng đời job.
   */
  videoSeed: number | null;
}

export interface LivestreamJobSummary {
  id: string;
  name: string;
  updatedAt: string;
  status: LivestreamJobStatus;
  productCount: number;
  /** Cần để lọc job cùng tỉ lệ khi chọn ghép nhiều job — xem lib/livestream/mergeConcat.ts. */
  aspectRatio: '9:16' | '16:9';
}

/** Gộp nhiều job (mỗi job đã tự "Ghép video" xong) thành 1 video livestream liên tục cuối cùng. */
export interface LivestreamMerge {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Slug các job, đúng thứ tự sẽ nối video — xem lib/livestream/mergeConcat.ts. */
  jobSlugs: string[];
  concat: ConcatState;
}

export interface LivestreamMergeSummary {
  id: string;
  name: string;
  updatedAt: string;
  status: ConcatStatus;
  jobCount: number;
}
