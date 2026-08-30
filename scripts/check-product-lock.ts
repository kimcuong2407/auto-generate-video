/**
 * Self-check khoá ngoại hình sản phẩm (product lock) + gán USP vào cảnh + QA kịch bản.
 *
 * Sai ở đây = sản phẩm đổi hình giữa các cảnh, hoặc USP không có cảnh demo, hoặc cảnh báo QA trỏ
 * sai đoạn — cả ba đều chỉ lộ ra sau khi đã đốt quota Veo gen video.
 */
import assert from 'node:assert/strict';
import {
  formatProductLockBlock,
  isProductLockStale,
  pickProductLockRefPaths,
  productLockFingerprint,
} from '../lib/livestream/productLock';
import {
  allocateAidaStages,
  assignUspToScenes,
  buildLivestreamV2UserPrompt,
} from '../lib/livestream/scriptPromptV2';
import { DEFAULT_V2_INPUT } from '../lib/livestream/v2Store';
import type { LivestreamProductLock } from '../lib/livestream/types';

const LOCK: LivestreamProductLock = {
  shape: 'khối tròn dẹt, dày đều',
  color: 'hồng pastel, có bản xanh mint',
  material: 'lưới nilon xốp, sợi mảnh',
  size: 'đường kính ~12cm, cầm gọn 1 tay',
  components: 'dây treo ngắn ở mép',
  neverChange: 'không mọc cán dài, không đổi màu giữa các cảnh',
};

// ── Khối lock phải mang ĐỦ mọi field vào prompt ───────────────────────────────
{
  const block = formatProductLockBlock(LOCK);
  for (const v of [LOCK.shape, LOCK.color, LOCK.material, LOCK.size, LOCK.components, LOCK.neverChange]) {
    assert.ok(block.includes(v), `khối lock thiếu "${v}"`);
  }
  assert.ok(/nguồn sự thật DUY NHẤT/.test(block), 'lock không được đặt là nguồn sự thật ưu tiên');
  assert.ok(!/undefined|NaN/.test(block), 'khối lock lọt giá trị rỗng');
}

// Field rỗng thì KHÔNG được để lại dòng trống vô nghĩa trong prompt.
{
  const block = formatProductLockBlock({ ...LOCK, components: '', neverChange: '' });
  assert.ok(!block.includes('Bộ phận cố định:'), 'components rỗng vẫn in ra nhãn');
  assert.ok(!block.includes('TUYỆT ĐỐI KHÔNG ĐỔI:'), 'neverChange rỗng vẫn in ra nhãn');
  assert.ok(block.includes(LOCK.shape), 'mất field bắt buộc khi field tuỳ chọn rỗng');
}

// ── Fingerprint: chỉ phụ thuộc ẢNH SẢN PHẨM ──────────────────────────────────
{
  const base = { selectedRefImagePaths: ['a.jpg', 'b.jpg'], scriptRefPaths: [] as string[] };
  // Đảo thứ tự cùng bộ ảnh → KHÔNG được tính là lệch (bỏ chọn rồi chọn lại).
  assert.equal(
    productLockFingerprint(base),
    productLockFingerprint({ ...base, selectedRefImagePaths: ['b.jpg', 'a.jpg'] }),
    'đảo thứ tự cùng bộ ảnh bị tính là lệch → chốt lại vô ích mỗi lần'
  );
  // Thêm ảnh sản phẩm → PHẢI lệch.
  assert.notEqual(
    productLockFingerprint(base),
    productLockFingerprint({ ...base, selectedRefImagePaths: ['a.jpg', 'b.jpg', 'c.jpg'] }),
    'thêm ảnh sản phẩm mà lock cũ vẫn được coi là khớp'
  );
}

// Lock stale đúng lúc: đổi ảnh sản phẩm thì phải chốt lại, chưa có lock thì không.
{
  const job = { selectedRefImagePaths: ['a.jpg'], scriptRefPaths: [] as string[] };
  const fresh = { ...LOCK, inputsFingerprint: productLockFingerprint(job) };
  assert.equal(isProductLockStale({ ...job, productLock: fresh }), false, 'lock mới bị coi là stale');
  assert.equal(
    isProductLockStale({ ...job, selectedRefImagePaths: ['a.jpg', 'z.jpg'], productLock: fresh }),
    true,
    'đổi bộ ảnh mà lock cũ vẫn được dùng lại'
  );
  assert.equal(isProductLockStale({ ...job, productLock: null }), false, 'chưa có lock mà báo stale');
  // Lock do bản code cũ chốt (thiếu fingerprint) → phải chốt lại đúng 1 lần.
  assert.equal(
    isProductLockStale({ ...job, productLock: { ...LOCK, inputsFingerprint: undefined } }),
    true,
    'lock thiếu dấu vết phải được chốt lại'
  );
}

// ── Chọn ảnh chốt lock: chỉ ảnh SẢN PHẨM, không lẫn ảnh mẫu/ảnh nền ──────────
{
  // Mr.D tick cả ảnh mẫu (model.jpg) lẫn ảnh sản phẩm → chỉ ảnh sản phẩm được dùng, nếu không
  // lock sẽ đi tả người dẫn thay vì món hàng.
  const picked = pickProductLockRefPaths({
    selectedRefImagePaths: ['p1.jpg', 'p2.jpg'],
    scriptRefPaths: ['model.jpg', 'p2.jpg'],
  });
  assert.deepEqual(picked, ['p2.jpg'], 'lọt ảnh không phải ảnh sản phẩm vào bước chốt lock');

  // Không tick gì → dùng toàn bộ ảnh sản phẩm (hành vi cũ).
  assert.deepEqual(
    pickProductLockRefPaths({ selectedRefImagePaths: ['p1.jpg'], scriptRefPaths: [] }),
    ['p1.jpg'],
    'không tick ảnh mà không rơi về toàn bộ ảnh sản phẩm'
  );
}

// ── Gán USP vào cảnh (thay cho lời dặn suông trong prompt) ───────────────────
{
  const stages = allocateAidaStages(10);
  const { byScene, dropped } = assignUspToScenes(stages, ['Tạo bọt tốt', 'Bề mặt mềm', 'Có dây treo']);

  assert.equal(byScene.length, stages.length, 'byScene phải cùng độ dài với số cảnh');
  assert.equal(dropped.length, 0, '10 cảnh mà vẫn bỏ sót USP');

  // USP chỉ được rơi vào cảnh Interest/Desire — Attention là hook, Action là chốt đơn.
  byScene.forEach((usp, i) => {
    if (usp) {
      assert.ok(
        stages[i] === 'interest' || stages[i] === 'desire',
        `USP rơi vào cảnh ${i + 1} thuộc giai đoạn ${stages[i]} (phải là interest/desire)`
      );
    }
  });

  // Mỗi USP xuất hiện đúng 1 lần, không trùng cảnh.
  const assigned = byScene.filter(Boolean) as string[];
  assert.equal(assigned.length, 3, `phải gán đủ 3 USP, nhận ${assigned.length}`);
  assert.equal(new Set(assigned).size, 3, 'có USP bị gán trùng vào nhiều cảnh');
}

// Nhiều USP hơn số cảnh demo → phần dư phải được BÁO, không im lặng cắt.
{
  const stages = allocateAidaStages(4); // chỉ 1 interest + 1 desire
  const many = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const { byScene, dropped } = assignUspToScenes(stages, many);
  const assigned = byScene.filter(Boolean) as string[];
  assert.ok(dropped.length > 0, 'thừa USP mà không báo dropped → im lặng cắt');
  assert.equal(assigned.length + dropped.length, many.length, 'USP bị thất lạc, không gán cũng không báo');
}

// Không có ưu điểm nào → không được crash, không gán bừa.
{
  const stages = allocateAidaStages(6);
  const { byScene, dropped } = assignUspToScenes(stages, []);
  assert.equal(byScene.filter(Boolean).length, 0, 'không có USP mà vẫn gán vào cảnh');
  assert.equal(dropped.length, 0, 'không có USP mà báo dropped');
}

// ── Prompt hoàn chỉnh: lock + USP phải cùng có mặt ──────────────────────────
{
  const prompt = buildLivestreamV2UserPrompt(
    'Bông tắm tròn tạo bọt',
    [8, 8, 8, 8, 8, 8],
    { ...DEFAULT_V2_INPUT, advantages: ['Tạo bọt tốt', 'Bề mặt mềm'] },
    'mô tả cũ từ vision',
    undefined,
    undefined,
    formatProductLockBlock(LOCK)
  );
  assert.ok(prompt.includes(LOCK.shape), 'khối lock không lọt vào user prompt');
  assert.ok(prompt.includes('USP phải demo bằng hình'), 'bảng cảnh thiếu USP đã gán');
  // Có lock thì KHÔNG kèm mô tả tự do nữa — hai bản mô tả cùng món hàng là để LLM tự chọn,
  // đúng thứ product lock sinh ra để loại bỏ.
  assert.ok(
    !prompt.includes('mô tả cũ từ vision'),
    'có product lock mà vẫn nhét thêm visualDescription → hai nguồn mâu thuẫn'
  );
}

// Không có lock → phải rơi về visualDescription như cũ (job chưa chọn ảnh / thiếu vision model).
{
  const prompt = buildLivestreamV2UserPrompt(
    'SP',
    [8, 8],
    DEFAULT_V2_INPUT,
    'mô tả cũ từ vision',
    undefined,
    undefined,
    undefined
  );
  assert.ok(prompt.includes('mô tả cũ từ vision'), 'mất visualDescription khi chưa có lock');
}

// ── Prompt QA phải phủ đủ các lỗi đã chốt trong khảo sát ────────────────────
{
  // Import muộn: promptDefaults kéo theo nhiều prompt dài, chỉ cần đúng hằng này.
  const { SCRIPT_QA_SYSTEM_PROMPT } = require('../lib/livestream/promptDefaults');
  for (const must of ['THỨ TỰ NHÂN QUẢ', 'bọt', 'claim', '1 hành động chính']) {
    assert.ok(
      SCRIPT_QA_SYSTEM_PROMPT.toLowerCase().includes(must.toLowerCase()),
      `prompt QA thiếu tiêu chí "${must}"`
    );
  }
  assert.ok(/"issues"/.test(SCRIPT_QA_SYSTEM_PROMPT), 'prompt QA không chốt format JSON trả về');
}

// Prompt sinh kịch bản V2 phải mang đúng 2 quy tắc vừa thêm.
{
  const { LIVESTREAM_V2_SYSTEM_PROMPT } = require('../lib/livestream/promptDefaultsV2');
  assert.ok(/THỨ TỰ NHÂN QUẢ/.test(LIVESTREAM_V2_SYSTEM_PROMPT), 'prompt V2 thiếu quy tắc nhân quả');
  assert.ok(
    /1 HÀNH ĐỘNG CHÍNH/i.test(LIVESTREAM_V2_SYSTEM_PROMPT),
    'prompt V2 thiếu ràng buộc 1 hành động chính mỗi cảnh'
  );
}

console.log('✅ check-product-lock: OK');
