import { NextRequest, NextResponse } from 'next/server';
import { loadPromptSet, savePrompt } from '@/lib/livestream/promptStore';
import { PROMPT_STEPS, fallbackFor, isPromptStepKey } from '@/lib/livestream/promptSteps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đọc/ghi prompt AI 2 tầng (bảng ai_prompts) — dùng chung cho trang /settings/prompts (tầng mặc
 * định) lẫn panel trong 1 job (tầng riêng job).
 *
 * GET  ?jobSlug=<slug>  → danh sách 11 bước kèm prompt đang có hiệu lực + tầng nào đang thắng.
 *                         Bỏ jobSlug = chỉ xem tầng mặc định toàn hệ thống.
 * PATCH { step, body, jobSlug? } → lưu. body=null XOÁ override của tầng đó (về tầng dưới).
 *
 * `body` LƯU NGUYÊN `${params}`: params fill theo từng sản phẩm lúc gen, lưu bản đã fill sẽ khiến
 * prompt kẹt vào sản phẩm đầu tiên của job.
 */
export async function GET(req: NextRequest) {
  const jobSlug = req.nextUrl.searchParams.get('jobSlug')?.trim() || undefined;
  // isV2: bước sinh kịch bản có 2 bản mặc định (V1 / AIDA Shopee) — sai cờ này thì nút "khôi phục
  // mặc định" trả về prompt của phiên bản kia.
  const isV2 = req.nextUrl.searchParams.get('v2') === '1';
  const set = await loadPromptSet(jobSlug);

  return NextResponse.json({
    jobSlug: jobSlug ?? null,
    steps: PROMPT_STEPS.map((s) => ({
      key: s.key,
      label: s.label,
      hint: s.hint,
      perJob: s.perJob,
      params: s.params,
      /** Prompt đang thực sự có hiệu lực (đã tính cả 2 tầng), còn nguyên ${params}. */
      effective: set.get(s.key, { isV2 }),
      /** Tầng nào đang thắng — để UI hiện badge, không phải đoán từ việc so chuỗi. */
      scope: set.scopeOf(s.key),
      /** Bản thô từng tầng: undefined = tầng đó chưa có gì. */
      jobBody: jobSlug ? set.raw(s.key, 'job') : undefined,
      globalBody: set.raw(s.key, 'global'),
      /** Hằng trong code — để nút "khôi phục mặc định" hiện đúng thứ sắp quay về. */
      fallback: fallbackFor(s.key, isV2),
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    step?: string;
    body?: string | null;
    jobSlug?: string | null;
  };

  if (!isPromptStepKey(body.step)) {
    return NextResponse.json({ error: `Bước không hợp lệ: ${body.step}` }, { status: 400 });
  }
  const step = PROMPT_STEPS.find((s) => s.key === body.step)!;
  const jobSlug = body.jobSlug?.trim() || undefined;

  // Bước chạy TRƯỚC khi job tồn tại (extract/vision/v2_field_extract) không có job để gắn override
  // — nhận bừa thì row đó nằm im trong DB mà không bao giờ được đọc, im lặng vô hiệu.
  if (jobSlug && !step.perJob) {
    return NextResponse.json(
      { error: `Bước "${step.label}" chạy trước khi job tồn tại nên chỉ sửa được bản mặc định toàn hệ thống.` },
      { status: 400 }
    );
  }
  // Phân biệt rõ null (xoá override) với chuỗi rỗng (tắt hẳn) — xem doc-comment bảng ai_prompts.
  if (body.body !== null && typeof body.body !== 'string') {
    return NextResponse.json({ error: 'Thiếu nội dung prompt' }, { status: 400 });
  }

  await savePrompt({ step: step.key, jobSlug, body: body.body ?? null });
  return NextResponse.json({ ok: true });
}
