import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateProjectId, projectInputsDir } from '@/lib/paths';
import { createProjectDirs, listProjects, writeProject } from '@/lib/data/projectStore';
import { createNewProject } from '@/lib/data/projectFactory';
import { MAX_IMAGE_COUNT, MAX_IMAGE_SIZE_BYTES } from '@/lib/constants';
import type { ProductInfo, Template } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();

  const name = String(form.get('name') || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Thiếu tên project' }, { status: 400 });
  }

  const aspectRatio = (String(form.get('aspectRatio') || '9:16') === '16:9' ? '16:9' : '9:16') as
    | '9:16'
    | '16:9';

  const templateRaw = form.get('template');
  let template: Template;
  try {
    const templateText =
      typeof templateRaw === 'string' ? templateRaw : await (templateRaw as File)?.text();
    template = JSON.parse(templateText || '{}') as Template;
    if (!Array.isArray(template.scenes) || template.scenes.length === 0) {
      throw new Error('Template thiếu mảng "scenes"');
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Template JSON không hợp lệ: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  let product: ProductInfo;
  try {
    const productRaw = String(form.get('product') || '{}');
    const parsed = JSON.parse(productRaw);
    product = {
      name: parsed.name || '',
      tagline: parsed.tagline || '',
      category: parsed.category || '',
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      material: parsed.material || '',
      keyFeatures: Array.isArray(parsed.keyFeatures) ? parsed.keyFeatures : [],
    };
  } catch {
    return NextResponse.json({ error: 'Thông tin sản phẩm (product) không hợp lệ' }, { status: 400 });
  }

  const images = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
  if (images.length === 0) {
    return NextResponse.json({ error: 'Cần ít nhất 1 ảnh sản phẩm' }, { status: 400 });
  }
  if (images.length > MAX_IMAGE_COUNT) {
    return NextResponse.json({ error: `Tối đa ${MAX_IMAGE_COUNT} ảnh` }, { status: 400 });
  }
  for (const img of images) {
    if (img.size > MAX_IMAGE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Ảnh "${img.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
        { status: 400 }
      );
    }
  }

  const background = form.get('background');
  const backgroundFile = background instanceof File && background.size > 0 ? background : null;

  const spokesperson = form.get('spokespersonImage');
  const spokespersonFile = spokesperson instanceof File && spokesperson.size > 0 ? spokesperson : null;
  if (spokespersonFile && spokespersonFile.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh người mẫu vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  const id = generateProjectId(name);
  await createProjectDirs(id);
  const inputsDir = projectInputsDir(id);

  const productImagePaths: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const file = images[i];
    const ext = path.extname(file.name) || '.jpg';
    const fileName = `product-${i + 1}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(inputsDir, fileName), buffer);
    productImagePaths.push(path.join('inputs', fileName));
  }

  const templateRelPath = path.join('inputs', 'template.json');
  await fs.writeFile(path.join(inputsDir, 'template.json'), JSON.stringify(template, null, 2), 'utf-8');

  let backgroundRelPath: string | null = null;
  if (backgroundFile) {
    const ext = path.extname(backgroundFile.name) || '.jpg';
    const fileName = `background${ext}`;
    const buffer = Buffer.from(await backgroundFile.arrayBuffer());
    await fs.writeFile(path.join(inputsDir, fileName), buffer);
    backgroundRelPath = path.join('inputs', fileName);
  }

  let spokespersonRelPath: string | null = null;
  if (spokespersonFile) {
    const ext = path.extname(spokespersonFile.name) || '.jpg';
    const fileName = `spokesperson${ext}`;
    const buffer = Buffer.from(await spokespersonFile.arrayBuffer());
    await fs.writeFile(path.join(inputsDir, fileName), buffer);
    spokespersonRelPath = path.join('inputs', fileName);
  }

  const project = createNewProject({
    id,
    name,
    template,
    product,
    aspectRatio,
    productImages: productImagePaths,
    templatePath: templateRelPath,
    backgroundPath: backgroundRelPath,
    spokespersonImagePath: spokespersonRelPath,
  });

  await writeProject(project);

  return NextResponse.json({ id, project }, { status: 201 });
}
