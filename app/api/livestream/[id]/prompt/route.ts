import { NextRequest, NextResponse } from 'next/server';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cập nhật prompt người dùng chỉnh cho job (job-level override): sinh kịch bản
 * (`scriptSystemPrompt`) và/hoặc gen ảnh background (`backgroundPrompt`).
 * Gửi chuỗi rỗng/null → xoá override, quay về prompt mặc định tương ứng (xem
 * resolveScriptSystemPrompt ở scriptPrompt.ts và resolveBackgroundPrompt ở backgroundGenerate.ts).
 * Trường nào KHÔNG có mặt trong body thì giữ nguyên — 2 panel lưu độc lập, không đè lên nhau.
 * Prompt extract/vision không cho override, chỉ hiển thị read-only ở UI.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    scriptSystemPrompt?: string | null;
    backgroundPrompt?: string | null;
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
  });

  return NextResponse.json({ job });
}
