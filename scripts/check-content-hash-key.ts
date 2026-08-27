/**
 * Self-check chống cache video bằng key mang hash nội dung:
 * - segmentVideoFileName: nội dung khác → tên file khác (CDN không có gì để trả bản cũ).
 * - keyFromPublicUrl: suy đúng key R2 để xoá bản cũ, không xoá nhầm URL lạ.
 * Chạy: npx tsx scripts/check-content-hash-key.ts
 */
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Đặt TRƯỚC khi import lib/constants (đọc env lúc load module).
const PUBLIC = 'https://video-r2.test';
process.env.R2_PUBLIC_URL = PUBLIC;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { segmentVideoFileName } = require('../lib/livestream/segmentSanitize');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { keyFromPublicUrl, md5File } = require('../lib/r2/client');

async function main() {
  // 1. Cùng order/id nhưng nội dung khác → tên file PHẢI khác (đây là điểm chống cache).
  const a = segmentVideoFileName(3, 'seg-03', 'aaaaaaaabbbbbbbb');
  const b = segmentVideoFileName(3, 'seg-03', 'ccccccccdddddddd');
  assert.notEqual(a, b, 'nội dung khác phải ra tên khác, nếu không CDN vẫn trả bản cũ');
  assert.equal(a, '003_seg-03.aaaaaaaa.mp4');
  assert.ok(a.endsWith('.mp4'), 'phải giữ đuôi .mp4 để content-type/ffmpeg nhận đúng');

  // 2. Cùng nội dung → cùng tên (gen lại y hệt không đẻ rác key mới).
  assert.equal(
    segmentVideoFileName(3, 'seg-03', 'aaaaaaaabbbbbbbb'),
    segmentVideoFileName(3, 'seg-03', 'aaaaaaaabbbbbbbb')
  );

  // 3. order được pad 3 chữ số để thứ tự ghép đúng khi sort theo tên.
  assert.equal(segmentVideoFileName(1, 'seg-01', 'deadbeef00'), '001_seg-01.deadbeef.mp4');
  assert.equal(segmentVideoFileName(12, 'seg-12', 'deadbeef00'), '012_seg-12.deadbeef.mp4');
  const names = [3, 1, 12, 2].map((o) => segmentVideoFileName(o, `seg-${o}`, 'deadbeef00'));
  assert.deepEqual([...names].sort(), names.slice().sort(), 'sort theo tên phải ổn định');
  assert.equal([...names].sort()[0], '001_seg-1.deadbeef.mp4');

  // 4. keyFromPublicUrl: URL thuộc bucket → trả key; bỏ query (cache-buster ?v=).
  assert.equal(
    keyFromPublicUrl(`${PUBLIC}/livestream/job-a/segments/003_seg-03.abc12345.mp4`),
    'livestream/job-a/segments/003_seg-03.abc12345.mp4'
  );
  assert.equal(
    keyFromPublicUrl(`${PUBLIC}/livestream/job-a/final.abc12345.mp4?v=123`),
    'livestream/job-a/final.abc12345.mp4'
  );

  // 5. URL không thuộc bucket / rỗng / path tương đối → null (KHÔNG suy bừa rồi xoá nhầm).
  for (const u of [
    null,
    undefined,
    '',
    'https://khac.example.com/livestream/x.mp4',
    PUBLIC + '/',
    '/api/livestream/abc/media/outputs/final.mp4',
  ]) {
    assert.equal(keyFromPublicUrl(u as string | null), null, `phải trả null cho: ${u}`);
  }

  // 6. md5File: cùng nội dung ra cùng hash, khác nội dung ra khác hash.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hashcheck-'));
  const f1 = path.join(dir, 'a.bin');
  const f2 = path.join(dir, 'b.bin');
  const f3 = path.join(dir, 'c.bin');
  await fs.writeFile(f1, 'video-noi-dung-1');
  await fs.writeFile(f2, 'video-noi-dung-1');
  await fs.writeFile(f3, 'video-noi-dung-2');
  const [h1, h2, h3] = await Promise.all([md5File(f1), md5File(f2), md5File(f3)]);
  assert.equal(h1, h2, 'cùng nội dung phải cùng hash');
  assert.notEqual(h1, h3, 'khác nội dung phải khác hash');
  assert.match(h1, /^[0-9a-f]{32}$/, 'md5 phải là 32 hex');
  await fs.rm(dir, { recursive: true, force: true });
}

main().then(() => console.log('✓ check-content-hash-key OK'));
