import { NextRequest, NextResponse } from 'next/server';
import { jobExists, updateJob } from '@/lib/livestream/jobStore';
import { isPromptBlockKey } from '@/lib/livestream/promptBlocks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Đặt danh sách KHỐI văn bản server tự ghép vào prompt mà job này TẮT (xem promptBlocks.ts).
 *
 * Body `{ disabled: string[] }` — thay TOÀN BỘ danh sách (không thêm/bớt từng cái), cùng kiểu
 * PUT của images/script-refs: UI luôn gửi trạng thái đầy đủ của mọi ô tick nên không cần merge,
 * và merge lại mở đường cho hai tab mở song song ghi đè lẫn nhau theo thứ tự khó đoán.
 *
 * Mảng rỗng = bật hết mọi khối (mặc định).
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { disabled?: unknown };
  if (!Array.isArray(body.disabled)) {
    return NextResponse.json({ error: 'Thiếu danh sách `disabled`' }, { status: 400 });
  }

  // Key lạ bị CHẶN ở đây (400) chứ không nhận bừa: nhận vào thì nó nằm im trong DB, không bao giờ
  // được đọc, và người gửi tưởng đã tắt được khối nào đó. Cùng cách /api/prompts chặn step sai.
  const keys = body.disabled.map(String);
  const invalid = keys.filter((k) => !isPromptBlockKey(k));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Khối prompt không tồn tại: ${invalid.join(', ')}` },
      { status: 400 }
    );
  }

  const { job } = await updateJob(id, (j) => {
    j.disabledPromptBlocks = [...new Set(keys)];
  });
  return NextResponse.json({ job });
}
