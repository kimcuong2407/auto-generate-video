/**
 * Self-check: chốt sân khấu THẤT BẠI không được im lặng.
 *
 * Ca thật (job production 825314, 3 lần liên tiếp): Mr.D bấm "Chốt lại sân khấu", UI báo thành
 * công, nhưng bible trong DB vẫn giữ fingerprint cũ và 32/32 đoạn vẫn ra người dẫn nữ.
 *
 * Nguyên nhân: ensureStageBible bọc `catch {}` nuốt TRỌN mọi lỗi rồi return null →
 * stageBibleBlock = undefined → user prompt MẤT HẲN khối sân khấu → LLM rơi về "BƯỚC 1 tự chốt
 * người dẫn" và bịa ra nữ 27 tuổi. Không ai biết vì lỗi đã bị nuốt ở 2 tầng (server + UI).
 *
 * Check này khoá lại 3 hợp đồng, mỗi cái ứng 1 tầng đã hỏng.
 *
 * Chạy: npx tsx scripts/check-stage-bible-failure.ts
 */
import assert from 'node:assert';
import fs from 'node:fs';

const stageBibleSrc = fs.readFileSync('lib/livestream/stageBible.ts', 'utf8');
const routeSrc = fs.readFileSync('app/api/livestream/[id]/script/generate/route.ts', 'utf8');
const pageSrc = fs.readFileSync('app/livestream/[id]/page.tsx', 'utf8');

// --- Tầng 1: ensureStageBible KHÔNG được nuốt lỗi khi force ---
assert.ok(
  /if\s*\(\s*opts\.force\s*\)\s*throw\s+err/.test(stageBibleSrc),
  'ensureStageBible phải NÉM lỗi khi force — nuốt lỗi = ghi đè script bằng người dẫn bịa'
);
assert.ok(
  !/catch\s*\{\s*\n\s*\/\/[^\n]*\n\s*return null;/.test(stageBibleSrc),
  'không được còn nhánh catch trống nuốt lỗi rồi return null'
);
assert.ok(
  stageBibleSrc.includes('console.error'),
  'nhánh không-force vẫn phải LOG lỗi, không im lặng'
);

// --- Tầng 2: chốt bible "mù" (có ảnh mẫu nhưng không đọc được ảnh) phải ném lỗi ---
assert.ok(
  stageBibleSrc.includes('thiếu AI_VISION_MODEL'),
  'có ảnh mẫu mà thiếu vision model → phải ném lỗi, KHÔNG được lặng lẽ chốt bible không nhìn ảnh'
);
assert.ok(
  stageBibleSrc.includes('Không đọc được ảnh người mẫu đã chọn'),
  'có ảnh mẫu mà đọc ảnh hỏng → phải ném lỗi thay vì bịa người dẫn'
);

// --- Tầng 3: route phải DỪNG HẲN khi force mà bible fail ---
assert.ok(routeSrc.includes("type: 'fatal'"), 'route phải gửi event fatal khi chốt sân khấu fail');
const fatalIdx = routeSrc.indexOf("type: 'fatal'");
const loopIdx = routeSrc.indexOf('for (const product of targets)');
assert.ok(fatalIdx > 0 && fatalIdx < loopIdx, 'fatal phải xảy ra TRƯỚC vòng lặp sinh script');
assert.ok(
  /controller\.close\(\);\s*\n\s*return;/.test(routeSrc),
  'sau fatal phải đóng stream và return — không được chạy tiếp vòng sinh script'
);
assert.ok(
  routeSrc.includes("type: 'stage_bible_missing'"),
  'bible null ở nhánh không-force cũng phải báo UI, không im lặng'
);

// --- Tầng 4: UI phải HIỆN lỗi, không báo thành công ---
assert.ok(pageSrc.includes("e.type === 'fatal'"), 'UI phải bắt event fatal');
assert.ok(pageSrc.includes("e.type === 'product_error'"), 'UI phải bắt product_error (trước đây bỏ qua hoàn toàn)');
assert.ok(
  pageSrc.includes('Sinh script thất bại') && pageSrc.includes('setActionError'),
  'UI phải hiện lỗi qua setActionError'
);
// Lỗi phải chặn trước thông báo "đã chốt lại thành công"
const fatalUiIdx = pageSrc.indexOf("if (fatal)");
const successIdx = pageSrc.indexOf('if (bibleRechecked)');
assert.ok(
  fatalUiIdx > 0 && fatalUiIdx < successIdx,
  'kiểm tra lỗi phải đứng TRƯỚC thông báo thành công, nếu không lỗi bị thông báo thành công che mất'
);

console.log('✓ check-stage-bible-failure: tất cả assert pass');
