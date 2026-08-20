import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectExists, updateProject } from '@/lib/data/projectStore';
import { projectInputsDir } from '@/lib/paths';
import { MAX_IMAGE_SIZE_BYTES } from '@/lib/constants';
import { uploadFileToR2 } from '@/lib/r2/client';
import { mimeFor } from '@/lib/googleFlow/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload/thay ảnh người mẫu (spokesperson) sau khi project đã tồn tại — ảnh
 * này được dùng làm character reference cho MỌI scene khi gen video, để
 * cùng 1 người xuất hiện xuyên suốt video review.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Thiếu ảnh người mẫu' }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  const inputsDir = projectInputsDir(id);
  const ext = path.extname(file.name) || '.jpg';
  const fileName = `spokesperson${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(inputsDir, fileName), buffer);
  const relPath = path.join('inputs', fileName);
  // Upload thêm lên R2 để bền/không phụ thuộc VPS — vẫn giữ file local (dùng làm ref khi gen storyboard).
  const imageUrl = await uploadFileToR2(
    path.join(inputsDir, fileName),
    `projects/${id}/inputs/${fileName}`,
    mimeFor(fileName)
  );

  const { project } = await updateProject(id, (p) => {
    p.inputs.spokespersonImagePath = relPath;
    p.inputs.spokespersonImageUrl = imageUrl;
  });

  return NextResponse.json({ project });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await projectExists(id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const { project } = await updateProject(id, (p) => {
    p.inputs.spokespersonImagePath = null;
    p.inputs.spokespersonImageUrl = null;
  });

  return NextResponse.json({ project });
}
