import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { extractV2Fields } from '@/lib/livestream/v2FieldExtract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chạy LẠI bước bóc tách form Shopee (V2) cho một sản phẩm ĐÃ TỒN TẠI.
 *
 * Khác /api/livestream/v2-extract: route kia chạy ở trang crawl, TRƯỚC khi job tồn tại, và nhận
 * text qua body để prefill form tạo mới. Route này đọc `rawText` đã lưu sẵn của sản phẩm — nguồn
 * text gốc duy nhất còn lại sau khi job được tạo.
 *
 * KHÔNG ghi gì vào DB. 9 field trả về không có bảng nào chứa trọn (lúc tạo job chúng bị nén vào
 * product.description); chỉ `advantages` là trùng với livestream_v2_inputs. Nên client tự quyết
 * đắp field nào đi đâu — xem ProductPanel.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; productId: string } }
) {
  const { id, productId } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const product = job.products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
  }

  const rawText = (product.rawText || '').trim();
  if (!rawText) {
    return NextResponse.json(
      {
        error:
          'Sản phẩm này không có text gốc để bóc tách (rawText rỗng — thường gặp với sản phẩm tạo từ ảnh hoặc nhập tay).',
      },
      { status: 400 }
    );
  }

  // extractV2Fields không bao giờ ném: AI lỗi thì trả bộ field rỗng kèm logRowId. Trả nguyên vẹn
  // để client tự thấy "AI không tách được gì" thay vì báo lỗi giả.
  // Truyền slug để lượt AI này gắn vào job — không có thì log rơi vào phạm vi toàn hệ thống và
  // timeline của job không hiện nó.
  const { fields, logRowId } = await extractV2Fields(rawText, job.slug);
  return NextResponse.json({ fields, logRowId });
}
