/**
 * Self-check cho logic dò URL session của extension (background.js →
 * collectSessionInMainWorld.discoverSessionUrls).
 *
 * Vì sao cần: Google đổi domain Flow sang flow.google.com và base path session không còn
 * là /fx/api/auth/session, nên extension dò URL từ performance entries của trang. Regex dò
 * sai là extension câm lặng "collect thất bại" — đúng lỗi đã mất 2 lượt debug.
 *
 * Check này giữ bản sao logic thuần (không cần Chrome) và assert nó chọn đúng URL.
 */
import assert from 'node:assert/strict';

const STATIC_PATHS = ['/fx/api/auth/session', '/api/auth/session', '/auth/session'];

/** Bản sao logic trong background.js — sửa 1 chỗ phải sửa cả 2. */
function discoverSessionUrls(entries: string[], origin: string): string[] {
  const found = entries.filter(
    (u) => typeof u === 'string' && /\/session(\?|$)/.test(u) && u.startsWith(origin)
  );
  return [...new Set([...found, ...STATIC_PATHS])];
}

const ORIGIN = 'https://flow.google.com';

// 1. Bắt được URL session thật dù base path lạ, và đặt nó TRƯỚC list tĩnh.
{
  const urls = discoverSessionUrls(
    [
      'https://flow.google.com/_/BardChatUi/data/batchexecute',
      'https://flow.google.com/fx/api/trpc/project.list',
      'https://flow.google.com/project/abc/api/auth/session',
      'https://fonts.googleapis.com/css2?family=Roboto',
    ],
    ORIGIN
  );
  assert.equal(urls[0], 'https://flow.google.com/project/abc/api/auth/session',
    'URL dò được phải xếp trước fallback tĩnh');
  assert.deepEqual(urls.slice(1), STATIC_PATHS);
}

// 2. Bỏ qua origin khác — không gửi cookie phiên sang domain lạ.
{
  const urls = discoverSessionUrls(['https://evil.example.com/api/auth/session'], ORIGIN);
  assert.deepEqual(urls, STATIC_PATHS, 'URL cross-origin phải bị loại');
}

// 3. Chấp nhận query string, loại URL chỉ *chứa* chữ session ở giữa path.
{
  const urls = discoverSessionUrls(
    [
      `${ORIGIN}/api/auth/session?x=1`,
      `${ORIGIN}/sessions/list`,
      `${ORIGIN}/api/session-info/detail`,
    ],
    ORIGIN
  );
  assert.deepEqual(urls, [`${ORIGIN}/api/auth/session?x=1`, ...STATIC_PATHS]);
}

// 4. Entries rỗng / performance bị chặn → vẫn còn fallback tĩnh để thử.
assert.deepEqual(discoverSessionUrls([], ORIGIN), STATIC_PATHS);

// 5. Dedupe: URL dò được trùng path tĩnh thì không thử 2 lần.
{
  const urls = discoverSessionUrls([`${ORIGIN}/fx/api/auth/session`], ORIGIN);
  assert.equal(urls.filter((u) => u.endsWith('/fx/api/auth/session')).length, 2,
    'absolute URL và path tương đối là 2 entry khác nhau, cả 2 đều đáng thử');
  assert.equal(new Set(urls).size, urls.length, 'không có entry trùng lặp y hệt');
}

console.log('check-flow-session-discovery: OK');
