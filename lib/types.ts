export type SceneStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed';

export interface TemplateScene {
  id: string;
  label: string;
  duration: number;
  type?: string;
  camera: string;
  focus?: string;
  lighting?: string;
  color_palette?: string;
}

export interface Template {
  product_category?: string;
  product_name?: string;
  video_style?: string;
  total_duration?: number;
  language?: string;
  tone?: string;
  scenes: TemplateScene[];
  voiceover?: {
    speaker_gender?: string;
    speaker_age?: string;
    style?: string;
    speed?: number;
  };
  music?: {
    genre?: string;
    bpm?: number;
    mood?: string;
    fade_out_duration?: number;
  };
}

export interface ProductInfo {
  name: string;
  tagline: string;
  category: string;
  colors: string[];
  material: string;
  keyFeatures: string[];
  /**
   * Mô tả HÌNH ẢNH thật của sản phẩm do AI vision đọc trực tiếp từ ảnh (màu sắc vật lý,
   * chất liệu, hình dạng, tỉ lệ, chi tiết nhìn thấy) — tách biệt với material/colors do
   * người dùng nhập tay. Dùng làm nguồn màu/chất liệu ĐÁNG TIN CẬY khi sinh veoPrompt/
   * storyboard, thay cho việc để model text tự bịa. Mặc định '' cho project cũ.
   */
  visualDescription: string;
}

export interface Scene {
  id: string;
  order: number;
  label: string;
  duration: number;
  camera: string;
  /** Loại cảnh (hook/demo/cta...), chỉ dùng hiển thị badge — không bắt buộc. */
  type?: string;
  voiceoverVi: string;
  onScreenText: string;
  veoPrompt: string;
  negativePrompt: string;
  status: SceneStatus;
  jobId: string | null;
  videoPath: string | null;
  /** URL public trên Cloudflare R2 sau khi upload thành công. Null nếu chưa upload hoặc R2 chưa cấu hình — khi đó dùng route stream local qua videoPath. */
  videoUrl: string | null;
  error: string | null;
  attempts: number;
  lastUpdatedAt: string | null;
  /** Đường dẫn tương đối (trong project dir) tới khung hình cuối đã extract từ videoPath, dùng làm start_path cho scene kế tiếp khi sceneChaining bật. Null nếu chưa extract. */
  lastFramePath: string | null;
  /** True nếu lần gen video gần nhất của scene này có dùng start_path lấy từ khung hình cuối scene trước (chain thành công). */
  chainedFromPrevious: boolean;
}

export interface ScriptState {
  totalDuration: number;
  aspectRatio: '9:16' | '16:9';
  scenes: Scene[];
}

export type StoryboardStatus = 'idle' | 'generating' | 'done' | 'failed';

export interface StoryboardImage {
  /** Khớp với Scene.id (script đã duyệt) — 1 ảnh storyboard / 1 scene trong kịch bản.
   * Ban đầu trùng TemplateScene.id lúc tạo project, sau đó theo id của script.scenes
   * (có thể đổi hẳn sau khi sinh nháp AI hoặc chỉnh tay ở Bước 2). */
  sceneId: string;
  order: number;
  prompt: string;
  /** Đường dẫn tương đối trong project dir, vd "outputs/storyboard/hook.png". Null nếu chưa gen. */
  imagePath: string | null;
  /** URL public trên Cloudflare R2 sau khi upload thành công. Null nếu chưa upload hoặc R2 chưa cấu hình — khi đó dùng route xem local qua imagePath. */
  imageUrl: string | null;
  status: StoryboardStatus;
  error: string | null;
  attempts: number;
  lastUpdatedAt: string | null;
}

export interface StoryboardState {
  /** Model ảnh Orino Flow (flow_generate_image), mặc định 'flow-image'. */
  model: string;
  /** Có gửi ảnh sản phẩm làm ảnh tham chiếu (img2img/edit) khi gen storyboard hay không. */
  useProductReference: boolean;
  /**
   * Đường dẫn (khớp 1 phần tử trong inputs.productImages) của ẢNH SẢN PHẨM DUY NHẤT được chọn
   * làm ref khi useProductReference = true — thay vì gửi tất cả ảnh sản phẩm. Null = chưa chọn,
   * fallback về ảnh đầu tiên trong inputs.productImages.
   */
  productReferenceImagePath: string | null;
  /** Có gửi ảnh nhân vật/người mẫu (inputs.spokespersonImagePath, Bước 1) làm ảnh tham chiếu khi gen storyboard hay không. */
  useSpokespersonReference: boolean;
  images: StoryboardImage[];
  /**
   * Ảnh background riêng / scene — chỉ bối cảnh, KHÔNG có sản phẩm/nhân vật. Dùng chung
   * type StoryboardImage vì cùng hình dạng dữ liệu (prompt/imagePath/status/error...).
   * Chỉ dùng để xem/tải ở Bước 3 — KHÔNG tự động gộp vào ref_paths khi gen video Bước 4.
   */
  backgrounds: StoryboardImage[];
}

export interface ProjectInputs {
  productImages: string[];
  /** URL public R2 song song với productImages (cùng index). Null ở vị trí nào = ảnh đó chưa upload/R2 chưa cấu hình. */
  productImageUrls: (string | null)[];
  templatePath: string;
  backgroundPath: string | null;
  /** URL public R2 của backgroundPath. Null nếu chưa upload/R2 chưa cấu hình. */
  backgroundUrl: string | null;
  /**
   * Ảnh người mẫu/người dẫn (spokesperson), null nếu không dùng người mẫu. Không dùng
   * trực tiếp khi gen video (Bước 4) — chỉ dùng làm ảnh tham chiếu khi gen storyboard
   * (Bước 3, gated bởi storyboard.useSpokespersonReference), để cùng 1 người xuất hiện
   * xuyên suốt trong ảnh storyboard mà Bước 4 dùng làm ref.
   */
  spokespersonImagePath: string | null;
  /** URL public R2 của spokespersonImagePath. Null nếu chưa upload/R2 chưa cấu hình. */
  spokespersonImageUrl: string | null;
}

export interface MusicConfig {
  path: string | null;
  volume: number;
  fadeOutDuration: number;
}

export type ConcatStatus = 'idle' | 'running' | 'done' | 'failed';

export interface ConcatMeta {
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface ConcatState {
  status: ConcatStatus;
  log: string[];
  outputPath: string | null;
  /** URL public trên Cloudflare R2 sau khi upload thành công. File local (outputPath) bị xoá sau khi upload xong, nên khi outputUrl có giá trị PHẢI ưu tiên dùng nó thay vì route stream local. */
  outputUrl: string | null;
  outputMeta: ConcatMeta | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface FlowStatusCache {
  flowConnected: boolean | null;
  geminiConnected: boolean | null;
  projectsError: string | null;
  checkedAt: string | null;
}

export type VeoModel =
  | 'veo_3_1_quality'
  | 'veo_3_1_fast'
  | 'veo_3_1_lite'
  | 'veo_3_1_lite_low_priority'
  | 'abra';

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  aspectRatio: '9:16' | '16:9';
  veoModel: VeoModel;
  /**
   * Khi bật, mỗi khi 1 scene gen xong sẽ tự extract khung hình cuối và dùng làm start_path
   * (image-to-video) cho scene kế tiếp, tạo continuity thị giác thật giữa các cảnh thay vì
   * chỉ dựa vào mô tả text. Mặc định true kể cả project cũ (backfill khi đọc — xem
   * projectStore.readProject). Khi bật, "Chạy toàn bộ" chạy tuần tự (cascade qua poll) thay
   * vì song song, vì scene sau cần chờ khung hình cuối của scene trước.
   */
  sceneChaining: boolean;
  /**
   * Khi bật, bước ghép video (Bước 6) sẽ burn onScreenText của từng scene lên video bằng
   * ffmpeg drawtext. Mặc định false — video ghép ra sạch, không có chữ/subtitle đè lên hình.
   */
  burnOnScreenText: boolean;
  flowProjectId: string | null;
  template: Template;
  product: ProductInfo;
  inputs: ProjectInputs;
  storyboard: StoryboardState;
  script: ScriptState;
  /** Góc kịch bản đang chọn để sinh nháp AI (VD: "unboxing", "problem-solution"...), null nếu chưa chọn. */
  scriptAngleId: string | null;
  music: MusicConfig;
  concat: ConcatState;
  flowStatusCache: FlowStatusCache;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  aspectRatio: '9:16' | '16:9';
  productName: string;
  scriptAngleId: string | null;
  sceneCount: number;
  /** Số scene đã có veoPrompt không rỗng — dùng hiển thị tiến độ "Prompt AI" ở màn danh sách. */
  promptReadyCount: number;
  /** True nếu có scene đang generating video — cảnh báo trước khi sinh prompt hàng loạt (API sẽ tự chặn ghi đè). */
  hasGeneratingScene: boolean;
}
