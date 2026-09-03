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
import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { DB_ENABLED } from '../db/config';
import { aiCallLogs } from '../db/schema/aiCallLogs';
import type { PromptStepKey } from '../livestream/promptSteps';

/** Số lượt giữ lại cho mỗi cặp (job, bước) — cũ hơn thì bị cắt tỉa ngay sau khi ghi. */
export const KEEP_RUNS = 20;

/** Nhãn của một lượt gọi AI: ai đang gọi, cho job nào, sản phẩm nào. */
export interface AiCallContext {
  stepKey: PromptStepKey;
  /** Bỏ trống = bước chạy TRƯỚC khi job tồn tại (extract / vision_screenshot / v2_field_extract). */
  jobSlug?: string;
  /** Bỏ trống = lượt cấp job (product_visual / product_lock / stage_bible). */
  productId?: string;
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
 * Trong danh sách rowId đã sắp GIẢM DẦN, trả về các rowId phải xoá để chỉ còn `keep` lượt mới nhất.
 *
 * Tách hàm thuần để self-check khoá lại off-by-one mà không cần DB — sai một nhịp ở đây là XOÁ
 * DỮ LIỆU THẬT, không phải hiện sai màn hình.
 */
export function rowIdsToDelete(sortedDescRowIds: number[], keep: number): number[] {
  return sortedDescRowIds.slice(keep);
}

/**
 * Ghi 1 lượt vào DB rồi cắt tỉa còn KEEP_RUNS lượt gần nhất của cặp (job, bước).
 *
 * TUYỆT ĐỐI KHÔNG ĐƯỢC NÉM: log là phụ trợ, để nó làm fail một lượt gen 32 đoạn là đổi tính năng
 * quan sát lấy một hồi quy thật. Hai try/catch TÁCH RIÊNG (insert / cắt tỉa) để insert thành công
 * mà cắt tỉa lỗi thì log VẪN xem được, và đọc log server phân biệt được ca nào hỏng.
 */
export async function recordAiCall(row: {
  stepKey: PromptStepKey;
  jobSlug: string;
  productId: string;
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

  try {
    await pruneAiCallLogs(row.jobSlug, row.stepKey);
  } catch (err) {
    console.error(`[callLog] cắt tỉa thất bại (${row.stepKey}): ${(err as Error).message}`);
  }
}

/**
 * Giữ KEEP_RUNS lượt gần nhất của 1 cặp (job, bước): 1 SELECT lấy mốc + 1 DELETE.
 *
 * VÌ SAO KHÔNG `DELETE ... WHERE row_id NOT IN (SELECT ... LIMIT n)`: MariaDB cấm subquery đọc
 * chính bảng đang DELETE (error 1093), và bọc thêm `SELECT * FROM (...) t` để lách thì mất index
 * → quét full bảng.
 *
 * `lte` chứ không `lt`: offset(KEEP_RUNS) với thứ tự giảm dần trả về lượt thứ (KEEP_RUNS + 1), nên
 * phải xoá CẢ nó mới còn đúng KEEP_RUNS lượt.
 *
 * An toàn với nhiều process PM2 ghi đồng thời mà không cần lock: mốc tính từ ảnh chụp tại thời
 * điểm SELECT nên không bao giờ xoá lượt MỚI hơn mốc. Hai process cắt song song cùng lắm để bảng
 * tạm giữ hơn KEEP_RUNS một nhịp rồi lần ghi sau cắt tiếp — ngưỡng là MỀM, thứ phải đúng là
 * "không mất lượt gần nhất".
 */
async function pruneAiCallLogs(jobSlug: string, stepKey: PromptStepKey): Promise<void> {
  const db = getDb();
  const scope = and(eq(aiCallLogs.jobSlug, jobSlug), eq(aiCallLogs.stepKey, stepKey));

  const [cutoff] = await db
    .select({ rowId: aiCallLogs.rowId })
    .from(aiCallLogs)
    .where(scope)
    .orderBy(desc(aiCallLogs.rowId))
    .limit(1)
    .offset(KEEP_RUNS);

  if (!cutoff) return; // chưa đủ KEEP_RUNS lượt → không có gì để cắt
  await db.delete(aiCallLogs).where(and(scope, lte(aiCallLogs.rowId, cutoff.rowId)));
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
