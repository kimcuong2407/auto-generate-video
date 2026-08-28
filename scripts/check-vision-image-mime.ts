/**
 * Self-check: mime type ảnh gửi cho AI vision phải suy từ NỘI DUNG, không từ đuôi file.
 *
 * Ca thật (production 2026-08-28, lặp 13 lần trong pm2 log): mọi lượt vision trả HTTP 400
 *   "messages.0.content.4.image.source.base64: The image was specified using the image/png
 *    media type, but the image appears to be a image/jpeg image"
 *
 * Nguyên nhân: ảnh do provider gen được lưu với đuôi `.png` HARD-CODE
 * (lib/googleFlow/imageGen.ts, lib/omniroute/imageGen.ts, lib/data/storyboardGenerate.ts,
 * lib/data/backgroundGenerate.ts) nhưng nội dung provider trả về là JPEG. Code cũ tra bảng
 * IMAGE_MIME theo path.extname() → khai 'image/png' cho file JPEG → API từ chối cả lượt gọi.
 *
 * Chạy: npx tsx scripts/check-vision-image-mime.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { sniffImageMime } from '../lib/data/productVisionExtract';

// --- 1. Nhận đúng chữ ký từng định dạng ---
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
const GIF = Buffer.from('GIF89a____', 'ascii');

assert.strictEqual(sniffImageMime(PNG), 'image/png', 'PNG phải nhận ra qua magic bytes');
assert.strictEqual(sniffImageMime(JPEG), 'image/jpeg', 'JPEG phải nhận ra qua magic bytes');
assert.strictEqual(sniffImageMime(WEBP), 'image/webp', 'WEBP phải nhận ra qua RIFF....WEBP');
assert.strictEqual(sniffImageMime(GIF), 'image/gif', 'GIF phải nhận ra qua GIF89a');

// --- 2. ĐÂY LÀ BUG THẬT: nội dung JPEG thì phải ra image/jpeg, bất kể tên file là .png ---
assert.strictEqual(
  sniffImageMime(JPEG),
  'image/jpeg',
  'File tên .png nhưng ruột JPEG phải khai image/jpeg — khai png là API trả HTTP 400'
);

// --- 3. Buffer rác/ngắn không được ném lỗi, fallback jpeg như hành vi cũ ---
assert.strictEqual(sniffImageMime(Buffer.alloc(0)), 'image/jpeg', 'buffer rỗng phải fallback, không crash');
assert.strictEqual(sniffImageMime(Buffer.from([0x00])), 'image/jpeg', 'buffer 1 byte phải fallback');
assert.strictEqual(sniffImageMime(Buffer.from('hello world', 'ascii')), 'image/jpeg', 'rác phải fallback');

// --- 4. Không được quay lại tra mime theo đuôi file ---
for (const f of ['lib/data/productVisionExtract.ts', 'lib/livestream/productVision.ts']) {
  const src = fs.readFileSync(f, 'utf8');
  assert.ok(
    !/IMAGE_MIME\s*\[/.test(src),
    `${f}: không được tra mime theo đuôi file (IMAGE_MIME[...]) — đuôi .png nói dối, phải sniff nội dung`
  );
  assert.ok(
    /sniffImageMime\(/.test(src),
    `${f}: phải dùng sniffImageMime() để lấy mime từ nội dung ảnh`
  );
}

console.log('OK check-vision-image-mime: 4/4 nhóm assert pass');
