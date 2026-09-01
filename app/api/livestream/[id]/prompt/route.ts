import { NextRequest, NextResponse } from 'next/server';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cập nhật prompt người dùng chỉnh cho job (job-level override): sinh kịch bản
 * (`scriptSystemPrompt`) và/hoặc gen ảnh background (`backgroundPrompt`).
 * Gửi chuỗi rỗng/null → xoá override, quay về prompt mặc định tương ứng (xem
 * resolveScriptSystemPrompt ở scriptPrompt.ts và resolveBackgroundPrompt ở backgroundGenerate.ts).
 * Trường nào KHÔNG có mặt trong body thì giữ nguyên — các panel lưu độc lập, không đè lên nhau.
 * Prompt extract/vision không cho override, chỉ hiển thị read-only ở UI.
 *
 * `negativePrompt` KHÁC 2 trường trên ở cách hiểu chuỗi rỗng: gửi null = khôi phục mặc định, còn
 * gửi chuỗi rỗng = TẮT HẲN negative prompt (người dùng chủ động xoá sạch ô). Ép rỗng→null như 2
 * trường kia sẽ khiến không ai tắt được, vì xoá sạch ô lại quay về mặc định — xem
 * resolveNegativePrompt ở lib/livestream/refImages.ts.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    scriptSystemPrompt?: string | null;
    backgroundPrompt?: string | null;
    negativePrompt?: string | null;
  };

  const { job } = await updateJob(id, (j) => {
    // Chỉ dùng .trim() để phân biệt rỗng→null; LƯU nguyên bản để không mất format prompt.
    if ('scriptSystemPrompt' in body) {
      const v = body.scriptSystemPrompt;
      j.scriptSystemPromptOverride = v && v.trim() ? v : null;
    }
    if ('backgroundPrompt' in body) {
      const v = body.backgroundPrompt;
      j.backgroundPromptOverride = v && v.trim() ? v : null;
    }
    // Giữ nguyên chuỗi rỗng (không ép về null): rỗng là lựa chọn hợp lệ nghĩa "không gửi negative
    // prompt nào". Chỉ null mới là "quay về mặc định".
    if ('negativePrompt' in body) {
      const v = body.negativePrompt;
      j.negativePromptOverride = v === null || v === undefined ? null : v;
    }
  });

  return NextResponse.json({ job });
}
