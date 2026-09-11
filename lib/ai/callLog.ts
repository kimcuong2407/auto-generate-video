/**
 * Gắn nhãn + ghi LOG lượt gọi AI: input/output THẬT của từng bước, để soát chất lượng prompt.
 *
 * VÌ SAO DÙNG AsyncLocalStorage chứ không truyền tham số xuống: mọi lượt gọi AI đều đi qua đúng
 * một cửa (`chatCompletion`), nhưng cửa đó nằm cách call-site 2-4 tầng hàm lồng nhau và chỉ nhận
 * (system, user, opts) — không có chỗ nào biết "lượt này là bước nào của job nào". Thêm tham số
 * xuyên qua cả 4 tầng là sửa hàng loạt chữ ký cho một việc phụ trợ.
 *
 * VÌ SAO KHÔNG SUY NHÃN TỪ NỘI DUNG PROMPT (phương án đã thử và bỏ): sẽ trượt ở đúng bước quan
 * trọng nhất — `fillPromptParams` thay ${ten_sanpham} nên chuỗi gửi đi KHÁC chuỗi đăng ký; và 2
 * bước lưu prompt trùng nội dung (chuyện bình thường khi copy-paste giữa 2 ô) sẽ bị gán lẫn nhãn,
 * tạo log SAI mà trông như thật — tệ hơn không có log.
 *
 * BỌC Ở CALL-SITE, KHÔNG BỌC Ở ROUTE: bọc ngay cạnh chỗ đã biết chắc stepKey thì đọc code là thấy
 * nhãn đúng. Bọc ở route còn vướng bẫy SSE: route sinh script gọi AI bên trong
 * `ReadableStream.start()`, mà Next gọi `start()` SAU khi handler return — context đã thoát, log
 * rơi hết vào rỗng một cách im lặng.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { DB_ENABLED } from '../db/config';
import { aiCallLogs } from '../db/schema/aiCallLogs';
import type { PromptStepKey } from '../livestream/promptSteps';


/** Nhãn của một lượt gọi AI: ai đang gọi, cho job nào, sản phẩm nào. */
export interface AiCallContext {
  stepKey: PromptStepKey;
  /** Bỏ trống = bước chạy TRƯỚC khi job tồn tại (extract / vision_screenshot / v2_field_extract). */
  jobSlug?: string;
  /** Bỏ trống = lượt cấp job (product_visual / product_lock / stage_bible). */
  productId?: string;
  /**
   * Id project của luồng Video Review. Bỏ trống = lượt của module livestream (dùng jobSlug).
   *
   * Hai luồng dùng 2 cột khác nhau chứ không dùng chung — xem doc-comment cột project_id ở
   * lib/db/schema/aiCallLogs.ts.
   */
  projectId?: string;
  /**
   * Dây chuyền sinh ra lượt này (xem lib/logs/sourceKind.ts). Bỏ trống = '' → tab log hiện
   * "không rõ".
   *
   * Vì sao phải TRUYỀN VÀO thay vì tự tra: nhãn livestream V1/V2 chỉ phân biệt được bằng row
   * trong livestream_v2_inputs, mà các bước chạy lúc TẠO job (extract / vision_screenshot) chạy
   * TRƯỚC khi row đó được ghi — tự tra ở đó sẽ gán nhầm mọi job V2 thành V1. Nơi biết chắc là
   * route tạo job, nên nhãn đi từ trên xuống.
   */
  sourceKind?: string;
  /** Tầng prompt đang thắng, lấy từ PromptSet.scopeOf(step) — có sẵn ở mọi call-site, không tốn query. */
  promptScope?: 'job' | 'global' | 'default';
  /** relPath/tên ảnh gửi kèm. chatCompletion chỉ nhận base64 nên tên ảnh PHẢI đi qua đây. */
  imagePaths?: string[];
  /**
   * Ô để recordAiCall ghi rowId của dòng log vừa tạo, cho caller đọc lại.
   *
   * Vì sao cần: bước v2_field_extract chạy ở TRANG CRAWL, trước cả khi job có tên. Muốn xem log
   * đó trong job detail thì phải biết dòng nào để gán lại cho job lúc tạo — xem claimAiCallLogs().
   * Dùng ô mutable thay vì giá trị trả về vì chatCompletion nằm sâu 2-4 tầng dưới caller.
   *
   * Đặt qua `withRowId()` chứ đừng tự dựng tay: ghi log chạy KHÔNG await (xem logAiCall ở
   * chatClient.ts) nên `rowId` gần như luôn CHƯA có ngay sau khi chatCompletion trả về — phải
   * await `settled` mới đọc được.
   */
  out?: RowIdSlot;
}

/** Ô nhận rowId của dòng log + promise báo đã ghi xong. Dựng bằng withRowId(). */
export interface RowIdSlot {
  rowId?: number;
  /** Resolve khi recordAiCall ghi xong (thành công hay lỗi) — await cái này rồi mới đọc rowId. */
  settled: Promise<void>;
  /** Nội bộ recordAiCall gọi để đóng `settled`. */
  done: () => void;
}

/**
 * Dựng ô nhận rowId cho MỘT lượt gọi AI.
 *
 * Dùng khi caller cần biết dòng log vừa ghi (để gán lại cho job sau đó). Chỉ những bước thật sự
 * cần mới dùng — 8 bước còn lại không đợi ghi log, giữ nguyên độ trễ như trước.
 */
export function withRowId(): RowIdSlot {
  let done!: () => void;
  const settled = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { settled, done };
}

const store = new AsyncLocalStorage<AiCallContext>();

/**
 * Bọc một lượt gọi AI để `chatCompletion` biết mình đang chạy cho bước nào.
 *
 * Đặt NGAY tại chỗ gọi chatCompletion (nơi đã biết chắc stepKey). Không bọc = không ghi log, và
 * đó là hành vi đúng cho luồng /projects (dùng chung chatCompletion nhưng không thuộc 11 bước).
 */
export function withAiCallContext<T>(ctx: AiCallContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

/** Nhãn của lượt đang chạy. undefined = lượt gọi ngoài phạm vi 11 bước → không ghi log. */
export function currentAiCallContext(): AiCallContext | undefined {
  return store.getStore();
}


/**
 * Ghi 1 lượt gọi AI vào DB. GIỮ VĨNH VIỄN — không cắt tỉa.
 *
 * Trước đây hàm này cắt còn 20 lượt gần nhất mỗi cặp (job, bước). Bỏ hẳn theo yêu cầu của Mr.D:
 * mục đích của bảng là truy vết lại về sau, mà cắt tỉa thì đúng lúc cần đối chiếu với lượt chạy
 * vài tuần trước là log đã mất. Hệ quả phải chấp nhận: bảng CHỈ TĂNG.
 *
 * Vì không còn cơ chế tự thu dọn, hai thứ thay chỗ nó — thiếu một trong hai là bảng phình âm thầm:
 *   - `npm run check:log-size` để canh dung lượng (cảnh báo khi vượt ngưỡng).
 *   - Nút xoá theo bộ lọc ở tab /logs (có xác nhận) — đường DUY NHẤT làm mất log, cố ý thủ công.
 * Và mọi truy vấn đọc BẮT BUỘC có `limit`: trước kia cắt tỉa đã chặn sẵn nên trần chỉ là hình
 * thức, giờ query không trần sẽ kéo cả bảng.
 *
 * TUYỆT ĐỐI KHÔNG ĐƯỢC NÉM: log là phụ trợ, để nó làm fail một lượt gen 32 đoạn là đổi tính năng
 * quan sát lấy một hồi quy thật.
 */
export async function recordAiCall(row: {
  stepKey: PromptStepKey;
  jobSlug: string;
  productId: string;
  projectId: string;
  sourceKind: string;
  model: string;
  promptScope: string;
  systemPrompt: string;
  userPrompt: string;
  output: string | null;
  errorMessage: string | null;
  imageCount: number;
  imagePaths: string[] | null;
  durationMs: number;
  attempts: number;
}): Promise<void> {
  // Đóng `settled` ở MỌI đường ra (kể cả DB tắt / insert lỗi): caller await nó, không đóng là treo.
  const slot = currentAiCallContext()?.out;
  if (!DB_ENABLED) {
    slot?.done();
    return;
  }

  try {
    const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const [res] = await getDb().insert(aiCallLogs).values({ ...row, createdAt: now });
    if (slot && typeof res?.insertId === 'number') slot.rowId = res.insertId;
  } catch (err) {
    console.error(`[callLog] ghi log thất bại (${row.stepKey}): ${(err as Error).message}`);
    return;
  } finally {
    slot?.done();
  }
}


/**
 * GÁN các dòng log đã ghi ở phạm vi toàn hệ thống về cho một job vừa được tạo.
 *
 * Vì sao cần: bước v2_field_extract chạy ở TRANG CRAWL và extract chạy lúc ingest — cả hai xảy ra
 * TRƯỚC khi job tồn tại nên ghi với job_slug = ''. Mr.D lại cần xem chúng trong job detail (đó là
 * input/output của "bước trước đó" dẫn tới job này). Gán lại là cách duy nhất giữ được log THẬT
 * mà không phải gọi AI thêm một lượt chỉ để có dấu vết.
 *
 * Chỉ gán theo rowId ĐÍCH DANH do caller nắm giữ, KHÔNG quét theo thời gian hay nội dung: Mr.D có
 * thể mở nhiều tab crawl rồi tạo job lần lượt, đoán theo "lượt gần nhất" sẽ gán log của sản phẩm
 * khác vào job này — bằng chứng đối chiếu sai còn tệ hơn không có.
 *
 * Best-effort: lỗi bị nuốt + log ra console, không chặn việc tạo job.
 */
export async function claimAiCallLogs(jobSlug: string, rowIds: number[]): Promise<void> {
  if (!DB_ENABLED || rowIds.length === 0) return;
  try {
    await getDb()
      .update(aiCallLogs)
      .set({ jobSlug })
      // Chỉ nhận dòng CÒN ở phạm vi toàn hệ thống: rowId đã thuộc job khác thì không cướp sang.
      .where(and(inArray(aiCallLogs.rowId, rowIds), eq(aiCallLogs.jobSlug, '')));
  } catch (err) {
    console.error(`[callLog] gán log cho job ${jobSlug} thất bại: ${(err as Error).message}`);
  }
}
