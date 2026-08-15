import { NextRequest, NextResponse } from 'next/server';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cập nhật system prompt sinh kịch bản do người dùng chỉnh cho job (job-level override).
 * Gửi chuỗi rỗng/null → xoá override, quay về LIVESTREAM_SYSTEM_PROMPT mặc định
 * (xem resolveScriptSystemPrompt ở lib/livestream/scriptPrompt.ts). Chỉ prompt sinh kịch bản
 * mới cho override; prompt extract/vision chỉ hiển thị read-only ở UI.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!jobExists(id)) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { scriptSystemPrompt?: string | null };

  const { job } = await updateJob(id, (j) => {
    const value = body.scriptSystemPrompt;
    // Chỉ dùng .trim() để phân biệt rỗng→null; LƯU nguyên bản để không mất format prompt.
    j.scriptSystemPromptOverride = value && value.trim() ? value : null;
  });

  return NextResponse.json({ job });
}
