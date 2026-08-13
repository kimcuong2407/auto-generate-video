import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import {
  mergeScenesWithTemplate,
  mergeStoryboardWithTemplate,
  mergeBackgroundsWithTemplate,
} from '@/lib/data/projectFactory';
import { projectInputsDir } from '@/lib/paths';
import { MAX_IMAGE_COUNT, MAX_IMAGE_SIZE_BYTES } from '@/lib/constants';
import type { ProductInfo, Template } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!projectExists(params.id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }
  const project = await readProject(params.id);
  return NextResponse.json({ project });
}

/**
 * Cập nhật Bước 1 sau khi project đã tồn tại: tên, tỷ lệ khung hình, template
 * kịch bản, thông tin sản phẩm, ảnh sản phẩm/background/người mẫu. Mọi field
 * đều tuỳ chọn — chỉ field nào gửi lên mới bị ghi đè. Khi template thay đổi
 * cấu trúc scene, dùng mergeScenesWithTemplate để giữ nguyên nội dung đã có
 * ở Bước 2 (voiceover/prompt/status/video) cho scene id trùng.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!projectExists(id)) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const form = await req.formData();
  const current = await readProject(id);
  const inputsDir = projectInputsDir(id);

  const name = form.has('name') ? String(form.get('name') || '').trim() : undefined;
  if (name !== undefined && !name) {
    return NextResponse.json({ error: 'Tên project không được để trống' }, { status: 400 });
  }

  const aspectRatioRaw = form.get('aspectRatio');
  const aspectRatio =
    aspectRatioRaw !== null ? (String(aspectRatioRaw) === '16:9' ? '16:9' : '9:16') : undefined;

  let template: Template | undefined;
  if (form.has('template')) {
    try {
      const templateText = String(form.get('template') || '');
      template = JSON.parse(templateText) as Template;
      if (!Array.isArray(template.scenes) || template.scenes.length === 0) {
        throw new Error('Template thiếu mảng "scenes"');
      }
    } catch (err) {
      return NextResponse.json(
        { error: `Template JSON không hợp lệ: ${(err as Error).message}` },
        { status: 400 }
      );
    }
  }

  let product: ProductInfo | undefined;
  if (form.has('product')) {
    try {
      const parsed = JSON.parse(String(form.get('product') || '{}'));
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
  }

  const images = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
  if (images.length > 0) {
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
  }

  const background = form.get('background');
  const backgroundFile = background instanceof File && background.size > 0 ? background : null;
  const removeBackground = String(form.get('removeBackground') || '') === 'true';

  const spokesperson = form.get('spokespersonImage');
  const spokespersonFile = spokesperson instanceof File && spokesperson.size > 0 ? spokesperson : null;
  const removeSpokespersonImage = String(form.get('removeSpokespersonImage') || '') === 'true';
  if (spokespersonFile && spokespersonFile.size > MAX_IMAGE_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Ảnh người mẫu vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB` },
      { status: 400 }
    );
  }

  // Tính trước cảnh báo mất dữ liệu (nếu template mới loại bỏ scene đã có video/đang gen),
  // để có thể chặn sớm mà không cần ghi file ảnh trước.
  let removedWithData: string[] = [];
  if (template) {
    const removedScenes = mergeScenesWithTemplate(current.script.scenes, template).removedWithData;
    const removedStoryboard = mergeStoryboardWithTemplate(current.storyboard.images, template).removedWithData;
    const removedBackgrounds = mergeBackgroundsWithTemplate(
      current.storyboard.backgrounds,
      template
    ).removedWithData;
    removedWithData = Array.from(new Set([...removedScenes, ...removedStoryboard, ...removedBackgrounds]));
    const force = String(form.get('force') || '') === 'true';
    if (removedWithData.length > 0 && !force) {
      return NextResponse.json(
        {
          error: 'scenes_removed_with_data',
          scenes: removedWithData,
          message: `Template mới sẽ loại bỏ ${removedWithData.length} cảnh đã có video/ảnh storyboard/đang tạo: ${removedWithData.join(
            ', '
          )}. Gửi lại kèm force=true nếu vẫn muốn tiếp tục.`,
        },
        { status: 409 }
      );
    }
    const generatingRemovedIds = new Set([
      ...current.script.scenes
        .filter((s) => removedWithData.includes(s.id) && s.status === 'generating')
        .map((s) => s.id),
      ...current.storyboard.images
        .filter((img) => removedWithData.includes(img.sceneId) && img.status === 'generating')
        .map((img) => img.sceneId),
      ...current.storyboard.backgrounds
        .filter((img) => removedWithData.includes(img.sceneId) && img.status === 'generating')
        .map((img) => img.sceneId),
    ]);
    if (generatingRemovedIds.size > 0) {
      return NextResponse.json(
        {
          error: `Không thể xoá cảnh đang generating: ${Array.from(generatingRemovedIds).join(', ')}. Vui lòng đợi hoặc thử lại sau.`,
        },
        { status: 409 }
      );
    }
  }

  // Đồng bộ file template.json trên đĩa với project.template mới (route tạo mới cũng ghi file này).
  if (template) {
    await fs.writeFile(path.join(inputsDir, 'template.json'), JSON.stringify(template, null, 2), 'utf-8');
  }

  // Ghi file ảnh mới (I/O ngoài transaction updateProject, giống route tạo mới).
  let productImagePaths: string[] | undefined;
  if (images.length > 0) {
    // Xoá ảnh sản phẩm cũ trước khi ghi ảnh mới để tránh rác file không còn tham chiếu.
    for (const oldPath of current.inputs.productImages) {
      await fs.unlink(path.join(inputsDir, path.basename(oldPath))).catch(() => {});
    }
    productImagePaths = [];
    for (let i = 0; i < images.length; i++) {
      const file = images[i];
      const ext = path.extname(file.name) || '.jpg';
      const fileName = `product-${i + 1}${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(path.join(inputsDir, fileName), buffer);
      productImagePaths.push(path.join('inputs', fileName));
    }
  }

  let backgroundRelPath: string | null | undefined;
  if (backgroundFile) {
    const ext = path.extname(backgroundFile.name) || '.jpg';
    const fileName = `background${ext}`;
    const buffer = Buffer.from(await backgroundFile.arrayBuffer());
    await fs.writeFile(path.join(inputsDir, fileName), buffer);
    backgroundRelPath = path.join('inputs', fileName);
  } else if (removeBackground) {
    if (current.inputs.backgroundPath) {
      await fs.unlink(path.join(inputsDir, path.basename(current.inputs.backgroundPath))).catch(() => {});
    }
    backgroundRelPath = null;
  }

  let spokespersonRelPath: string | null | undefined;
  if (spokespersonFile) {
    const ext = path.extname(spokespersonFile.name) || '.jpg';
    const fileName = `spokesperson${ext}`;
    const buffer = Buffer.from(await spokespersonFile.arrayBuffer());
    await fs.writeFile(path.join(inputsDir, fileName), buffer);
    spokespersonRelPath = path.join('inputs', fileName);
  } else if (removeSpokespersonImage) {
    if (current.inputs.spokespersonImagePath) {
      await fs.unlink(path.join(inputsDir, path.basename(current.inputs.spokespersonImagePath))).catch(() => {});
    }
    spokespersonRelPath = null;
  }

  const { project } = await updateProject(id, (p) => {
    if (name !== undefined) p.name = name;
    if (aspectRatio !== undefined) {
      p.aspectRatio = aspectRatio;
      p.script.aspectRatio = aspectRatio;
    }
    if (product !== undefined) p.product = product;
    if (template !== undefined) {
      p.template = template as Template;
      const merged = mergeScenesWithTemplate(p.script.scenes, template as Template);
      p.script.scenes = merged.scenes;
      p.script.totalDuration = merged.scenes.reduce((sum, s) => sum + s.duration, 0);
      p.storyboard.images = mergeStoryboardWithTemplate(p.storyboard.images, template as Template).images;
      p.storyboard.backgrounds = mergeBackgroundsWithTemplate(
        p.storyboard.backgrounds,
        template as Template
      ).images;
    }
    if (productImagePaths !== undefined) p.inputs.productImages = productImagePaths;
    if (backgroundRelPath !== undefined) p.inputs.backgroundPath = backgroundRelPath;
    if (spokespersonRelPath !== undefined) p.inputs.spokespersonImagePath = spokespersonRelPath;
  });

  return NextResponse.json({ project, removedScenes: removedWithData });
}
