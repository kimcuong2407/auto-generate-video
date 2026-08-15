import type { ConcatState, FlowStatusCache, VeoModel } from '../types';

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
  /**
   * Đường dẫn tương đối ảnh người mẫu/người dẫn tham chiếu, null nếu không dùng. Chỉ dùng làm
   * refPaths (character reference) cho đoạn không có startPath từ frame-chaining (đoạn đầu tiên
   * của chuỗi chain, hoặc job.chaining='off') — refPaths và startPath loại trừ nhau ở tầng
   * endpoint Google Flow nên không thể dùng đồng thời, xem lib/livestream/segmentGenerate.ts.
   */
  spokespersonImagePath: string | null;
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

export interface LivestreamJob {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  aspectRatio: '9:16' | '16:9';
  veoModel: VeoModel;
  chaining: LivestreamChaining;
  status: LivestreamJobStatus;
  products: LivestreamProduct[];
  concat: ConcatState;
  flowStatusCache: FlowStatusCache;
  flowProjectId: string | null;
  /**
   * System prompt sinh kịch bản do người dùng chỉnh cho job này. null = dùng
   * LIVESTREAM_SYSTEM_PROMPT mặc định (xem resolveScriptSystemPrompt ở scriptPrompt.ts).
   * Chỉ override prompt sinh kịch bản; prompt extract/vision không cho override (chỉ read-only ở UI).
   */
  scriptSystemPromptOverride: string | null;
}

export interface LivestreamJobSummary {
  id: string;
  name: string;
  updatedAt: string;
  status: LivestreamJobStatus;
  productCount: number;
}
