/**
 * Self-check cho readImageSize()/assertAspect() trong lib/googleFlow/imageGen.ts.
 *
 * Vì sao cần: Google trả ảnh sai tỉ lệ một cách KHÔNG ổn định. Nếu parser header đọc sai
 * kích thước, guard sẽ im lặng cho qua đúng thứ nó sinh ra để chặn — ảnh ngang lọt vào làm
 * khung khởi điểm gen video 9:16 mà không có lỗi nào được ném ra.
 *
 * Chạy: npx tsx scripts/check-image-aspect.ts
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __testables } from '../lib/googleFlow/imageGen';

const { readImageSize, assertAspect } = __testables;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aspect-'));

/** Sinh ảnh thật bằng ffmpeg thay vì hard-code byte — bắt được cả lỗi parser lẫn lỗi giả định format. */
function make(name: string, w: number, h: number): Buffer {
  const out = path.join(tmp, name);
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=gray:s=${w}x${h}`, '-frames:v', '1', out], {
    stdio: 'ignore',
  });
  return fs.readFileSync(out);
}

const jpgPortrait = make('a.jpg', 768, 1376);
const jpgLandscape = make('b.jpg', 1376, 768);
const png = make('c.png', 900, 1600);

// 1. Đọc đúng kích thước JPEG (width/height KHÔNG được hoán vị).
assert.deepEqual(readImageSize(jpgPortrait), { width: 768, height: 1376 });
assert.deepEqual(readImageSize(jpgLandscape), { width: 1376, height: 768 });

// 2. Đọc đúng kích thước PNG.
assert.deepEqual(readImageSize(png), { width: 900, height: 1600 });

// 3. Không nhận dạng được → trả null, và assertAspect phải cho qua (không chặn luồng).
assert.equal(readImageSize(Buffer.from('khong-phai-anh')), null);
assertAspect(Buffer.from('khong-phai-anh'), '9:16');

// 4. Đúng tỉ lệ → không ném.
assertAspect(jpgPortrait, '9:16');
assertAspect(jpgLandscape, '16:9');

// 5. Ngang↔dọc lẫn lộn → PHẢI ném (đây chính là ca lỗi thật đã gặp).
assert.throws(() => assertAspect(jpgLandscape, '9:16'), /sai tỉ lệ/);
assert.throws(() => assertAspect(jpgPortrait, '16:9'), /sai tỉ lệ/);

// 6. Lệch nhẹ trong dung sai 12% → cho qua (model làm tròn kích thước).
assertAspect(make('d.jpg', 720, 1280), '9:16');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('OK — image aspect guard: 6/6 checks passed');
