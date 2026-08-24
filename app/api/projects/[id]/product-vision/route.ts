import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { projectInputsDir } from '@/lib/paths';
import { extractVisualDescription } from '@/lib/data/productVisionExtract';
import { ensureLocalFile } from '@/lib/r2/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chạy AI vision đọc ảnh sản phẩm của project → sinh mô tả thị giác (màu/chất liệu/hình dạng
 * thật) và lưu vào product.visualDescription. Dùng cho nút "AI phân tích ảnh" ở Bước 1.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(params.id);
  const productImages = project.inputs.productImages || [];
  if (productImages.length === 0) {
    return NextResponse.json(
      { error: 'Project chưa có ảnh sản phẩm nào để phân tích' },
      { status: 400 }
    );
  }

  const absPaths = productImages.map((rel) =>
    path.join(projectInputsDir(params.id), path.basename(rel))
  );
  // Khôi phục local từ R2 nếu mất (project chạy/gen ở máy khác với máy tạo project).
  await Promise.all(
    absPaths.map((abs, i) => ensureLocalFile(abs, project.inputs.productImageUrls?.[i]))
  );

  try {
    const visualDescription = await extractVisualDescription(absPaths);
    if (!visualDescription) {
      return NextResponse.json({ error: 'AI không trả về mô tả hợp lệ' }, { status: 502 });
    }

    await updateProject(params.id, (p) => {
      p.product.visualDescription = visualDescription;
    });

    return NextResponse.json({ ok: true, visualDescription });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
