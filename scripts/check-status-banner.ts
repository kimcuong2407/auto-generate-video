/**
 * Self-check: băng thông báo của trang project phải nằm CỐ ĐỊNH ở header.
 *
 * Vì sao cần: đây là lỗi UX đã xảy ra thật — banner lỗi nằm cuối card, sau danh sách 7 cảnh, nên
 * bấm nút ở đầu trang thì thông báo hiện ngoài màn hình. Mr.D bấm "Gen background tất cả" và
 * thấy "không có gì xảy ra", trong khi app CÓ báo lý do, chỉ là báo ở chỗ không ai nhìn thấy.
 *
 * Ràng buộc kiểm ở đây (không cái nào typecheck bắt được):
 *   1. StatusBannerSlot phải nằm NGOÀI .content — chỉ .content cuộn (app/globals.css), đặt trong
 *      đó là banner trôi mất, quay lại đúng bug cũ.
 *   2. Mọi bước của trang project phải báo lỗi qua banner header, không tự dựng banner trong card.
 *   3. CSS .status-banner phải có flex-shrink:0 — thiếu nó thì băng bị co lại thành vạch mỏng khi
 *      danh sách cảnh dài.
 *
 * Chạy: npm run check:status-banner
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// --- 1. Slot nằm ngoài .content, ngay sau Topbar ---
{
  const page = read('app/projects/[id]/page.tsx');
  assert.match(page, /<StatusBannerProvider/, 'trang project phải bọc StatusBannerProvider');
  assert.match(page, /<StatusBannerSlot\s*\/>/, 'trang project phải render StatusBannerSlot');

  const slotAt = page.indexOf('<StatusBannerSlot');
  const contentAt = page.indexOf('className="content"');
  assert.ok(slotAt > 0 && contentAt > 0, 'không tìm thấy slot hoặc .content');
  assert.ok(
    slotAt < contentAt,
    'StatusBannerSlot phải đứng TRƯỚC .content — nằm trong .content là banner cuộn mất khỏi màn hình'
  );

  const topbarAt = page.indexOf('<Topbar');
  assert.ok(topbarAt > 0 && topbarAt < slotAt, 'slot phải nằm ngay dưới Topbar (vùng header)');

  // Banner phải tự dọn khi đổi bước, nếu không lỗi Bước 3 dính sang Bước 4.
  assert.match(
    page,
    /<StatusBannerProvider\s+resetKey=\{currentStep\}/,
    'phải truyền resetKey={currentStep} để banner tự xoá khi chuyển bước'
  );
}

// --- 2. Các bước dùng banner header, không dựng banner riêng trong card ---
{
  const STEPS = ['UploadStep', 'ScriptReviewStep', 'StoryboardStep', 'ConcatStep'];
  for (const name of STEPS) {
    const src = read(`components/steps/${name}.tsx`);
    assert.match(
      src,
      /useStatusBanner\(\)/,
      `${name} phải báo lỗi qua useStatusBanner() để thông báo hiện ở header`
    );
    assert.ok(
      !/\{error && <div className="banner"/.test(src),
      `${name} còn banner lỗi dựng trong card — nó cuộn mất khỏi màn hình, đúng bug đã sửa`
    );
    // useState<string|null> cho error nghĩa là lỗi lại nằm cục bộ, không lên header.
    assert.ok(
      !/const \[error, setError\] = useState/.test(src),
      `${name} còn state error cục bộ — phải đẩy lên banner header`
    );
  }
}

// --- 3. CSS: băng không được co lại, và có đủ 3 kiểu màu ---
{
  const css = read('app/globals.css');
  const block = /\.status-banner\s*\{([^}]*)\}/.exec(css);
  assert.ok(block, 'thiếu class .status-banner trong globals.css');
  assert.match(
    block![1],
    /flex-shrink:\s*0/,
    '.status-banner phải flex-shrink:0 — main là flex-column, thiếu nó thì băng bị co thành vạch mỏng'
  );
  for (const kind of ['banner-error', 'banner-info', 'banner-success']) {
    assert.ok(css.includes(`.status-banner.banner-${kind.split('-')[1]}`), `thiếu kiểu màu .${kind}`);
  }
}

console.log('✅ check-status-banner: 3/3 nhóm pass');
