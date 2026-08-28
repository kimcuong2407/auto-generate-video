/**
 * Self-check cho readImageSize()/assertAspect() trong lib/googleFlow/imageGen.ts.
 *
 * Vì sao cần: Google trả ảnh sai tỉ lệ một cách KHÔNG ổn định. Nếu parser header đọc sai
 * kích thước, guard sẽ im lặng cho qua đúng thứ nó sinh ra để chặn — ảnh ngang lọt vào làm
 * khung khởi điểm gen video 9:16 mà không có lỗi nào được ném ra.
 *
 * Ảnh mẫu được dựng bằng buffer thuần thay vì gọi ffmpeg: check phải chạy được ở mọi máy
 * (ffmpeg là dependency ngoài, có thể thiếu hoặc hỏng link thư viện — đã gặp trên máy dev khi
 * Homebrew nâng x265 làm ffmpeg 7.1.1 crash SIGABRT, khiến check fail dù logic hoàn toàn đúng).
 * readImageSize() chỉ đọc HEADER nên header hợp lệ là đủ để kiểm nó.
 *
 * Chạy: npx tsx scripts/check-image-aspect.ts
 */
import assert from 'node:assert/strict';
import { __testables } from '../lib/googleFlow/imageGen';

const { readImageSize, assertAspect } = __testables;

/**
 * Dựng JPEG tối thiểu nhưng ĐÚNG cấu trúc: SOI + APP0(JFIF) + SOF0 mang w/h + EOI.
 * Quan trọng: chèn APP0 trước SOF0 để parser buộc phải NHẢY QUA segment theo độ dài
 * (i += 2 + length) mới tới được SOF0 — nếu parser nhảy sai, check sẽ bắt được.
 */
function makeJpeg(w: number, h: number): Buffer {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ]);
  const sof0 = Buffer.alloc(21);
  sof0.writeUInt16BE(0xffc0, 0); // marker SOF0
  sof0.writeUInt16BE(0x0011, 2); // length = 17
  sof0.writeUInt8(8, 4); // precision
  sof0.writeUInt16BE(h, 5); // height  <- offset i+5
  sof0.writeUInt16BE(w, 7); // width   <- offset i+7
  sof0.writeUInt8(3, 9); // 3 component
  // Bẫy parser nhảy sai: segment COM chứa một SOF0 GIẢ (ff c0) mang kích thước khác hẳn.
  // Parser đúng dùng độ dài segment để vượt qua nguyên khối COM và tới SOF0 thật; parser
  // nhảy 2 byte một sẽ đâm vào SOF0 giả và đọc ra 111x222. Không có bẫy này, mutation
  // "i += 2" lọt lưới vì vẫn vô tình dừng đúng chỗ.
  const fakeSof = Buffer.alloc(9);
  fakeSof.writeUInt16BE(0xffc0, 0);
  fakeSof.writeUInt16BE(0x0011, 2);
  fakeSof.writeUInt8(8, 4);
  fakeSof.writeUInt16BE(222, 5); // height giả
  fakeSof.writeUInt16BE(111, 7); // width giả
  const comBody = Buffer.concat([fakeSof, Buffer.alloc(4, 0x20)]);
  const com = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    (() => {
      const b = Buffer.alloc(2);
      b.writeUInt16BE(comBody.length + 2, 0);
      return b;
    })(),
    comBody,
  ]);
  // DHT (0xFFC4) nằm trong dải 0xC0-0xCF nhưng KHÔNG phải SOF — parser phải loại trừ nó.
  // Đặt trước SOF0 thật với kích thước giả để bắt lỗi bỏ điều kiện `marker !== 0xc4`.
  const dht = Buffer.alloc(11);
  dht.writeUInt16BE(0xffc4, 0);
  dht.writeUInt16BE(0x0009, 2);
  dht.writeUInt16BE(444, 5); // "height" giả nếu bị đọc nhầm thành SOF
  dht.writeUInt16BE(333, 7); // "width" giả
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    com,
    dht,
    sof0,
    Buffer.alloc(16, 0x55), // thân ảnh giả, đủ dài để vòng lặp parser không chạm biên
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** Dựng PNG tối thiểu: 8 byte signature + chunk IHDR mang w/h ở offset 16/20. */
function makePng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  buf.writeUInt8(8, 24); // bit depth
  buf.writeUInt8(2, 25); // color type
  return buf;
}

const make = (_name: string, w: number, h: number): Buffer =>
  _name.endsWith('.png') ? makePng(w, h) : makeJpeg(w, h);

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

console.log('OK — image aspect guard: 6/6 checks passed');
