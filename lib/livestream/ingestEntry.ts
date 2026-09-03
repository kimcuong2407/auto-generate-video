import fs from 'node:fs/promises';
import path from 'node:path';
import { buildProduct } from './jobFactory';
import { fetchProductFromLink } from './productFetch';
import { extractProductInfo } from './productExtract';
import { extractProductFromImage } from './productVision';
import { splitProductBlocks } from './textIngest';
import { MAX_PRODUCTS_PER_ENTRY, MAX_TEXT_FILE_SIZE_BYTES } from './constants';
import { MAX_IMAGE_SIZE_BYTES } from '../constants';
import { downloadImageUrls } from '../downloadImages';
import type { LivestreamProduct } from './types';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const TEXT_EXTS = new Set(['.txt', '.csv']);

export interface EntryInput {
  type: 'link' | 'file' | 'manual';
  link?: string;
  text?: string;
  fileField?: string;
  /**
   * URL ảnh sản phẩm remote (VD ảnh crawl Shopee) — server tải về làm kho ảnh sản phẩm
   * (spokespersonImagePaths). Chỉ dùng ở nhánh 'manual' (luồng tạo job từ trang crawl).
   */
  imageUrls?: string[];
  /**
   * Dữ liệu gốc nguồn crawl gửi kèm (node `item` Shopee) — lưu nguyên vào sản phẩm để đối chiếu
   * "gốc → AI viết lại". Chỉ nhánh 'manual' (luồng tạo job từ trang crawl) mới có.
   */
  sourceRaw?: unknown;
  targetDurationSec: number;
}

export interface IngestEntryResult {
  products: LivestreamProduct[];
  warnings: string[];
  /**
   * Ảnh sản phẩm (crawl remote / file ảnh) thu được từ entry này — đường dẫn tương đối. Nơi gọi
   * (app/api/livestream/route.ts) gom tất cả entry rồi gán vào BỘ ẢNH CHUNG cấp job
   * (job.spokespersonImagePaths), vì ảnh nay áp chung cả job chứ không gắn theo từng sản phẩm.
   */
  imagePaths?: string[];
}

/** Trả về tên + mô tả sản phẩm, kèm cảnh báo mềm nếu AI chuẩn hoá thất bại (vẫn dùng text gốc). */
async function extractOrFallback(
  text: string,
  /** Slug job đang tạo — để log lượt AI gắn thẳng vào job, xem được ở job detail. */
  jobSlug: string
): Promise<{ name: string; description: string; ingestError: string | null }> {
  try {
    const info = await extractProductInfo(text, jobSlug);
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
  sourceFilePath: string | null,
  jobSlug: string,
  sourceRaw?: unknown
): Promise<LivestreamProduct[]> {
  let blocks = splitProductBlocks(text);
  if (blocks.length > MAX_PRODUCTS_PER_ENTRY) {
    warnings.push(
      `Phát hiện ${blocks.length} sản phẩm trong 1 nguồn, chỉ lấy ${MAX_PRODUCTS_PER_ENTRY} sản phẩm đầu tiên.`
    );
    blocks = blocks.slice(0, MAX_PRODUCTS_PER_ENTRY);
  }

  return Promise.all(
    blocks.map(async (block, blockIndex) => {
      const info = await extractOrFallback(block, jobSlug);
      return buildProduct({
        order: 0,
        sourceType,
        sourceFilePath,
        rawText: block,
        // Chỉ gắn cho khối ĐẦU: 1 lần crawl = 1 sản phẩm Shopee, nếu text bị splitProductBlocks
        // tách thành nhiều khối thì các khối sau không thuộc về JSON gốc này.
        sourceRaw: blockIndex === 0 ? sourceRaw : undefined,
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
  entryIndex: number,
  /** Slug job đang tạo — để log lượt AI (chuẩn hoá mô tả / đọc ảnh) gắn thẳng vào job. */
  jobSlug: string
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
    const info = await extractOrFallback(fetched, jobSlug);
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
    const products = await ingestTextBlocks(
      text,
      'manual',
      targetDurationSec,
      warnings,
      null,
      jobSlug,
      entry.sourceRaw
    );

    // Kho ảnh sản phẩm cho luồng crawl: tải ảnh remote (imageUrls) + ảnh File (field 'images')
    // vào inputs/. Ảnh nay áp CHUNG cả job nên trả về imagePaths cho nơi gọi gom vào
    // job.spokespersonImagePaths (không gắn theo product nữa).
    const imagePaths: string[] = [];
    if (products.length > 0) {
      const urls = Array.isArray(entry.imageUrls) ? entry.imageUrls : [];
      if (urls.length > 0) {
        imagePaths.push(...(await downloadImageUrls(urls, inputsDir, imagePaths.length)));
      }
      const rawFiles = form.getAll('images');
      const files = rawFiles.filter((f): f is File => f instanceof File && f.size > 0);
      for (const file of files) {
        const ext = path.extname(file.name).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) {
          warnings.push(`Entry #${entryIndex + 1}: bỏ qua "${file.name}" (không phải ảnh)`);
          continue;
        }
        if (file.size > MAX_IMAGE_SIZE_BYTES) {
          warnings.push(
            `Entry #${entryIndex + 1}: ảnh "${file.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB — đã bỏ qua`
          );
          continue;
        }
        const fileName = `product-${imagePaths.length + 1}${ext}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(path.join(inputsDir, fileName), buffer);
        imagePaths.push(path.join('inputs', fileName));
      }
    }

    return { products, warnings, imagePaths };
  }

  // entry.type === 'file'
  // Lấy tất cả file cùng field (form khởi tạo có thể gửi nhiều ảnh cho 1 sản phẩm).
  const rawFiles = entry.fileField ? form.getAll(entry.fileField) : [];
  const files = rawFiles.filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { products: [], warnings: [`Entry #${entryIndex + 1}: thiếu file`] };
  }
  const firstExt = path.extname(files[0].name).toLowerCase();

  if (IMAGE_EXTS.has(firstExt)) {
    // Lưu tất cả ảnh hợp lệ vào inputs/, thu thập đường dẫn tương đối làm ảnh tham chiếu.
    const savedImagePaths: string[] = [];
    let imgIndex = 0;
    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        warnings.push(`Entry #${entryIndex + 1}: bỏ qua "${file.name}" (không phải ảnh khi entry là ảnh)`);
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        warnings.push(
          `Entry #${entryIndex + 1}: ảnh "${file.name}" vượt quá ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB — đã bỏ qua`
        );
        continue;
      }
      const fileName = `product-${entryIndex + 1}-${imgIndex}${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(path.join(inputsDir, fileName), buffer);
      savedImagePaths.push(path.join('inputs', fileName));
      imgIndex += 1;
    }

    if (savedImagePaths.length === 0) {
      return { products: [], warnings };
    }

    // Dùng ảnh đầu tiên để trích mô tả. Nếu đã cấu hình AI_VISION_MODEL, đọc ảnh tự động ngay lúc
    // ingest (giống nhánh text gọi extractOrFallback ở trên) — thất bại/chưa cấu hình thì fallback
    // về needs_manual, người dùng vẫn có thể thử lại qua route products/[productId]/vision sau.
    let ingestStatus: 'ready' | 'needs_manual' = 'needs_manual';
    let ingestError: string | null =
      'Chưa cấu hình AI_VISION_MODEL — vui lòng nhập mô tả sản phẩm thủ công từ ảnh này, hoặc thử lại ở trang chi tiết job.';
    let name: string | undefined;
    let description: string | undefined;
    try {
      const info = await extractProductFromImage(
        path.join(inputsDir, path.basename(savedImagePaths[0])),
        jobSlug
      );
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
          sourceFilePath: savedImagePaths[0],
          ingestStatus,
          ingestError,
          name,
          description,
          targetDurationSec,
        }),
      ],
      warnings,
      imagePaths: savedImagePaths,
    };
  }

  // Nhánh text: chỉ xử lý file đầu tiên (nhiều file text không hỗ trợ gộp).
  const file = files[0];
  const ext = firstExt;
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
      path.join('inputs', fileName),
      jobSlug
    );
    return { products, warnings };
  }

  return {
    products: [],
    warnings: [`Entry #${entryIndex + 1}: định dạng file "${file.name}" chưa hỗ trợ (chỉ nhận ảnh, .txt, .csv)`],
  };
}
