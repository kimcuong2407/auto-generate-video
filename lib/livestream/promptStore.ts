/**
 * Đọc/ghi prompt người dùng chỉnh (bảng ai_prompts) — 2 tầng: riêng job và mặc định toàn hệ thống.
 *
 * VÌ SAO ĐỌC MỘT LẦN CHO CẢ LƯỢT GEN (loadPromptSet) thay vì resolve lẻ từng bước: một lượt sinh
 * script chạm tới 6 prompt khác nhau (product_visual → product_lock → stage_bible → script →
 * script_qa → shorten) nằm rải rác ở 6 module lồng nhau. Resolve lẻ là 6 round-trip DB cho dữ liệu
 * gần như không đổi.
 *
 * VÌ SAO KHÔNG CACHE THEO TTL: app chạy nhiều process PM2, mỗi process giữ một cache riêng. Sửa
 * prompt xong bấm gen ngay sẽ ăn bản cũ hay bản mới tuỳ request rơi vào process nào — lỗi ngẫu
 * nhiên, không tái hiện được. Đọc lại mỗi lượt gen là một query nhỏ, rẻ hơn nhiều so với chi phí
 * đi tìm loại bug đó.
 *
 * Chốt snapshot ở ĐẦU lượt gen cũng đúng về mặt ngữ nghĩa: gen 32 đoạn mà sửa prompt giữa chừng
 * thì kết quả không bị lai 2 phiên bản prompt.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { aiPrompts } from '../db/schema/prompts';
import { fallbackFor, type PromptStepKey } from './promptSteps';

/** Tầng global dùng chuỗi rỗng làm scope — xem doc-comment của bảng ai_prompts. */
const GLOBAL_SCOPE = '';

/**
 * Ảnh chụp prompt tại một thời điểm. `get()` là hàm THUẦN (không I/O) nên gọi thoải mái ở mọi
 * tầng sâu mà không phát sinh query ngoài dự kiến.
 */
export interface PromptSet {
  /** Prompt thực dùng cho 1 bước: job → global → hằng mặc định trong code. */
  get(step: PromptStepKey, opts?: { isV2?: boolean }): string;
  /** Tầng đang có hiệu lực — để UI hiện badge đúng, không phải đoán. */
  scopeOf(step: PromptStepKey): 'job' | 'global' | 'default';
  /** Bản thô đúng 1 tầng (undefined = tầng đó không có row). Dùng cho ô sửa ở UI. */
  raw(step: PromptStepKey, scope: 'job' | 'global'): string | undefined;
}

/**
 * Dựng PromptSet từ 2 tầng đã nạp. Export để self-check kiểm được thứ tự ưu tiên + ngữ nghĩa
 * chuỗi rỗng mà không cần DB — đây đúng là phần logic dễ viết sai nhất của module này.
 */
export function buildPromptSet(
  jobRows: Map<PromptStepKey, string>,
  globalRows: Map<PromptStepKey, string>
): PromptSet {
  return {
    get(step, opts) {
      // Thứ tự: bản riêng job → bản mặc định đã chỉnh → hằng trong code.
      // Dùng `has` chứ KHÔNG `||`: body rỗng là lựa chọn hợp lệ (tắt hẳn negative prompt), `||`
      // sẽ nuốt nó và rơi ngược về mặc định — đúng bug resolveNegativePrompt đã cảnh báo.
      if (jobRows.has(step)) return jobRows.get(step)!;
      if (globalRows.has(step)) return globalRows.get(step)!;
      return fallbackFor(step, opts?.isV2);
    },
    scopeOf(step) {
      if (jobRows.has(step)) return 'job';
      if (globalRows.has(step)) return 'global';
      return 'default';
    },
    raw(step, scope) {
      return (scope === 'job' ? jobRows : globalRows).get(step);
    },
  };
}

/**
 * Nạp toàn bộ prompt có hiệu lực cho 1 job (bỏ jobSlug = chỉ tầng global, dùng cho các bước chạy
 * TRƯỚC khi job tồn tại như extract/v2_field_extract).
 */
export async function loadPromptSet(jobSlug?: string): Promise<PromptSet> {
  const db = getDb();
  const scopes = jobSlug ? [GLOBAL_SCOPE, jobSlug] : [GLOBAL_SCOPE];
  const rows = await db
    .select({ stepKey: aiPrompts.stepKey, jobSlug: aiPrompts.jobSlug, body: aiPrompts.body })
    .from(aiPrompts)
    .where(inArray(aiPrompts.jobSlug, scopes));

  const jobRows = new Map<PromptStepKey, string>();
  const globalRows = new Map<PromptStepKey, string>();
  for (const r of rows) {
    const target = r.jobSlug === GLOBAL_SCOPE ? globalRows : jobRows;
    target.set(r.stepKey as PromptStepKey, r.body);
  }
  return buildPromptSet(jobRows, globalRows);
}

/** PromptSet rỗng (mọi bước rơi về hằng mặc định) — dùng ở self-check và nhánh không có DB. */
export function emptyPromptSet(): PromptSet {
  return buildPromptSet(new Map(), new Map());
}

/**
 * Lưu prompt cho 1 bước. `body = null` XOÁ row → bước đó quay về tầng dưới (job xoá thì về global,
 * global xoá thì về hằng mặc định). Chuỗi rỗng KHÁC null: nó ghi row rỗng nghĩa "tắt hẳn".
 */
export async function savePrompt(args: {
  step: PromptStepKey;
  /** Bỏ trống = ghi vào tầng mặc định toàn hệ thống. */
  jobSlug?: string;
  body: string | null;
}): Promise<void> {
  const db = getDb();
  const scope = args.jobSlug ?? GLOBAL_SCOPE;
  if (args.body === null) {
    await db
      .delete(aiPrompts)
      .where(and(eq(aiPrompts.stepKey, args.step), eq(aiPrompts.jobSlug, scope)));
    return;
  }
  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');
  await db
    .insert(aiPrompts)
    .values({ stepKey: args.step, jobSlug: scope, body: args.body, createdAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { body: args.body, updatedAt: now } });
}
