import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_IMAGE_SIZE_BYTES } from './constants';

/** ext ảnh suy từ content-type khi tải ảnh remote (URL Shopee thường không có đuôi file). */
export function extFromContentType(ct: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  };
  return map[ct.split(';')[0].trim().toLowerCase()] || '.jpg';
}

/**
 * Tải danh sách ảnh remote (URL) về `inputsDir`, đánh số file bắt đầu từ `startIndex`
 * (để nối tiếp sau các ảnh File đã ghi trước đó). Trả về mảng đường dẫn TƯƠNG ĐỐI
 * `inputs/product-N.ext`. Lỗi 1 ảnh (URL hỏng/không phải ảnh/quá lớn/timeout) chỉ bỏ qua
 * ảnh đó, không ném lỗi — giữ đúng hành vi "best effort" khi khởi tạo từ ảnh crawl.
 */
export async function downloadImageUrls(
  urls: string[],
  inputsDir: string,
  startIndex: number
): Promise<string[]> {
  const savedPaths: string[] = [];
  for (const url of urls) {
    try {
      // Timeout 15s để URL treo không block cả request vô thời hạn.
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const ct = resp.headers.get('content-type') || '';
      if (!ct.toLowerCase().startsWith('image/')) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_IMAGE_SIZE_BYTES) continue;
      const fileName = `product-${startIndex + savedPaths.length + 1}${extFromContentType(ct)}`;
      await fs.writeFile(path.join(inputsDir, fileName), buffer);
      savedPaths.push(path.join('inputs', fileName));
    } catch {
      // bỏ qua ảnh tải lỗi
    }
  }
  return savedPaths;
}
