import { NextRequest, NextResponse } from 'next/server';
import { resolveGate } from '@/lib/livestream/stepGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trả lời một bước AI đang dừng chờ duyệt (chế độ debug — xem lib/livestream/stepGate.ts).
 *
 * Vì sao là route riêng chứ không gửi ngược qua SSE: SSE một chiều, stream chỉ đẩy được xuống
 * client. Câu trả lời phải đi bằng request khác rồi resolve promise mà stream đang await.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    gateId?: string;
    decision?: 'run' | 'skip';
  };
  if (!body.gateId) {
    return NextResponse.json({ error: 'Thiếu gateId' }, { status: 400 });
  }
  if (body.decision !== 'run' && body.decision !== 'skip') {
    return NextResponse.json({ error: 'decision phải là "run" hoặc "skip"' }, { status: 400 });
  }
  if (!resolveGate(body.gateId, body.decision)) {
    // Hết 10 phút chờ, hoặc request sinh script đã đứt (F5/đóng tab) → cổng không còn ai đợi.
    return NextResponse.json(
      { error: 'Bước này không còn chờ duyệt (đã hết giờ hoặc lượt chạy đã dừng). Hãy chạy lại.' },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: true });
}
