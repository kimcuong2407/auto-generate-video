import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { savePrompt } from '@/lib/livestream/promptStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cập nhật prompt người dùng chỉnh cho MỘT job — nay ghi vào bảng ai_prompts (tầng riêng job) chứ
 * không còn vào 3 cột của livestream_jobs.
 *
 * Giữ nguyên hình dạng body cũ (`scriptSystemPrompt` / `backgroundPrompt` / `negativePrompt`) để 2
 * UI hiện có không phải sửa; route mới /api/prompts mới là đường đầy đủ 11 bước.
 *
 * Gửi null = XOÁ override của job, quay về bản mặc định toàn hệ thống (rồi mới tới hằng trong code).
 *
 * `negativePrompt` KHÁC 2 trường kia ở cách hiểu chuỗi rỗng: null = khôi phục mặc định, còn chuỗi
 * rỗng = TẮT HẲN negative prompt. Ép rỗng→null như 2 trường kia sẽ khiến không ai tắt được, vì xoá
 * sạch ô lại quay về mặc định — xem doc-comment bảng ai_prompts.
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

  // Chỉ dùng .trim() để phân biệt rỗng→xoá; LƯU nguyên bản để không mất format prompt.
  if ('scriptSystemPrompt' in body) {
    const v = body.scriptSystemPrompt;
    await savePrompt({ step: 'script', jobSlug: id, body: v && v.trim() ? v : null });
  }
  if ('backgroundPrompt' in body) {
    const v = body.backgroundPrompt;
    await savePrompt({ step: 'background', jobSlug: id, body: v && v.trim() ? v : null });
  }
  // Giữ nguyên chuỗi rỗng (không ép về null): rỗng là lựa chọn hợp lệ nghĩa "không gửi negative
  // prompt nào". Chỉ null mới là "quay về mặc định".
  if ('negativePrompt' in body) {
    const v = body.negativePrompt;
    await savePrompt({ step: 'negative_video', jobSlug: id, body: v === null || v === undefined ? null : v });
  }

  const job = await readJob(id);
  return NextResponse.json({ job });
}
