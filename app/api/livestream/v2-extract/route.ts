import { NextRequest, NextResponse } from 'next/server';
import { extractV2Fields } from '@/lib/livestream/v2FieldExtract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tách text sản phẩm thô → các ô form /livestream-v2/new (1 lượt AI).
 *
 * Đặt ở cấp /api/livestream (không phải /[id]/...) vì chạy TRƯỚC khi có job — dùng để prefill form
 * tạo mới. Không ghi gì vào DB.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text || '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Thiếu text sản phẩm' }, { status: 400 });
  }
  const { fields, logRowId } = await extractV2Fields(text);
  // `logRowId` để trang crawl giữ lại rồi gửi kèm lúc tạo job — server gán log về job đó nên
  // Mr.D xem được input/output của bước này ngay trong job detail.
  return NextResponse.json({ fields, logRowId });
}
