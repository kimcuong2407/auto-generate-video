import fs from 'node:fs/promises';
import path from 'node:path';
import { buildProduct } from './jobFactory';
import { fetchProductFromLink } from './productFetch';
import { extractProductInfo } from './productExtract';
import { extractProductFromImage } from './productVision';
import { splitProductBlocks } from './textIngest';
import { MAX_PRODUCTS_PER_ENTRY, MAX_TEXT_FILE_SIZE_BYTES } from './constants';
import { MAX_IMAGE_SIZE_BYTES } from '../constants';
import type { LivestreamProduct } from './types';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const TEXT_EXTS = new Set(['.txt', '.csv']);

export interface EntryInput {
  type: 'link' | 'file' | 'manual';
  link?: string;
  text?: string;
  fileField?: string;
  targetDurationSec: number;
}

export interface IngestEntryResult {
  products: LivestreamProduct[];
  warnings: string[];
}

/** Trả về tên + mô tả sản phẩm, kèm cảnh báo mềm nếu AI chuẩn hoá thất bại (vẫn dùng text gốc). */
async function extractOrFallback(text: string): Promise<{ name: string; description: string; ingestError: string | null }> {
  try {
    const info = await extractProductInfo(text);
    return { name: info.name, description: info.description, ingestError: null };
  } catch (err) {
    const firstLine = text.split('\n').find((l) => l.trim())?.trim().slice(0, 80) || 'Sản phẩm chưa rõ tên';
    return {
      name: firstLine,
      description: text.slice(0, 1000),
      ingestError: `AI chưa chuẩn hoá được mô tả (${(err as Error).message}) — đang dùng text gốc, có thể chỉnh sửa thủ công.`,
    };
  }
}

async function ingestTextBlocks(
  text: string,
  sourceType: 'file_text' | 'manual',
  targetDurationSec: number,
  warnings: string[],
  sourceFilePath: string | null
): Promise<LivestreamProduct[]> {
  let blocks = splitProductBlocks(text);
  if (blocks.length > MAX_PRODUCTS_PER_ENTRY) {
    warnings.push(
      `Phát hiện ${blocks.length} sản phẩm trong 1 nguồn, chỉ lấy ${MAX_PRODUCTS_PER_ENTRY} sản phẩm đầu tiên.`
    );
    blocks = blocks.slice(0, MAX_PRODUCTS_PER_ENTRY);
  }

  return Promise.all(
    blocks.map(async (block) => {
      const info = await extractOrFallback(block);
      return buildProduct({
        order: 0,
        sourceType,
        sourceFilePath,
        rawText: block,
        ingestStatus: 'ready',
        ingestError: info.ingestError,
        name: info.name,
        description: info.description,
        targetDurationSec,
      });
    })
  );
}

/** Xử lý 1 entry input (link/file/manual) từ form tạo job thành 1+ LivestreamProduct. */
export async function ingestEntry(
  entry: EntryInput,
  form: FormData,
  inputsDir: string,
  entryIndex: number
): Promise<IngestEntryResult> {
  const warnings: string[] = [];
  const targetDurationSec = Math.max(1, Math.round(Number(entry.targetDurationSec) || 0) || 60);

  if (entry.type === 'link') {
    const link = String(entry.link || '').trim();
    if (!link) {
      return { products: [], warnings: [`Entry #${entryIndex + 1}: thiếu link`] };
    }
    const fetched = await fetchProductFromLink(link);
    if (!fetched) {
      return {
        products: [
          buildProduct({
            order: 0,
            sourceType: 'link',
            sourceLink: link,
            rawText: null,
            ingestStatus: 'needs_manual',
            ingestError:
              'Không tự đọc được nội dung từ link này (trang có thể chặn truy cập tự động) — vui lòng dán mô tả sản phẩm thủ công.',
            targetDurationSec,
          }),
        ],
        warnings,
      };
    }
    const info = await extractOrFallback(fetched);
    return {
      products: [
        buildProduct({
          order: 0,
          sourceType: 'link',
          sourceLink: link,
          rawText: fetched,
          ingestStatus: 'ready',
          ingestError: info.ingestError,
          name: info.name,
          description: info.description,
          targetDurationSec,
        }),
      ],
      warnings,
    };
  }

  if (entry.type === 'manual') {
    const text = String(entry.text || '').trim();
    if (!text) {
      return { products: [], warnings: [`Entry #${entryIndex + 1}: thiếu mô tả`] };
    }
    const products = await ingestTextBlocks(text, 'manual', targetDurationSec, warnings, null);
    return { products, warnings };
  }

  // entry.type === 'file'
  const file = entry.fileField ? form.get(entry.fileField) : null;
  if (!(file instanceof File) || file.size === 0) {
    return { products: [], warnings: [`Entry #${entryIndex + 1}: thiếu file`] };
  }
  const ext = path.extname(file.name).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        products: [],
        warnings: [`Entry #${entryIndex + 1}: ảnh "${file.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB`],
      };
    }
    const fileName = `product-${entryIndex + 1}${ext}`;
    const absPath = path.join(inputsDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(absPath, buffer);

    // Nếu đã cấu hình AI_VISION_MODEL, đọc ảnh tự động ngay lúc ingest (giống nhánh text
    // gọi extractOrFallback ở trên) — thất bại/chưa cấu hình thì fallback về needs_manual,
    // người dùng vẫn có thể thử lại qua route products/[productId]/vision sau khi tạo job.
    let ingestStatus: 'ready' | 'needs_manual' = 'needs_manual';
    let ingestError: string | null =
      'Chưa cấu hình AI_VISION_MODEL — vui lòng nhập mô tả sản phẩm thủ công từ ảnh này, hoặc thử lại ở trang chi tiết job.';
    let name: string | undefined;
    let description: string | undefined;
    try {
      const info = await extractProductFromImage(absPath);
      ingestStatus = 'ready';
      ingestError = null;
      name = info.name;
      description = info.description;
    } catch (err) {
      ingestError = `AI đọc ảnh thất bại (${(err as Error).message}) — vui lòng nhập mô tả thủ công hoặc thử lại ở trang chi tiết job.`;
    }

    return {
      products: [
        buildProduct({
          order: 0,
          sourceType: 'file_image',
          sourceFilePath: path.join('inputs', fileName),
          ingestStatus,
          ingestError,
          name,
          description,
          targetDurationSec,
        }),
      ],
      warnings,
    };
  }

  if (TEXT_EXTS.has(ext)) {
    if (file.size > MAX_TEXT_FILE_SIZE_BYTES) {
      return {
        products: [],
        warnings: [`Entry #${entryIndex + 1}: file "${file.name}" vượt quá ${MAX_TEXT_FILE_SIZE_BYTES / 1024 / 1024}MB`],
      };
    }
    const text = await file.text();
    const fileName = `products-${entryIndex + 1}${ext}`;
    await fs.writeFile(path.join(inputsDir, fileName), text, 'utf-8');
    const products = await ingestTextBlocks(
      text,
      'file_text',
      targetDurationSec,
      warnings,
      path.join('inputs', fileName)
    );
    return { products, warnings };
  }

  return {
    products: [],
    warnings: [`Entry #${entryIndex + 1}: định dạng file "${file.name}" chưa hỗ trợ (chỉ nhận ảnh, .txt, .csv)`],
  };
}
