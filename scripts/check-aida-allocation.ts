/**
 * Self-check phân bổ AIDA cho kịch bản Livestream V2 (allocateAidaStages).
 *
 * Sai ở đây = kịch bản thiếu hook hoặc thiếu CTA mà vẫn gen video bình thường → chỉ phát hiện
 * sau khi đốt hết quota Veo. Rẻ hơn nhiều nếu chặn tại đây.
 */
import assert from 'node:assert/strict';
import {
  allocateAidaStages,
  sceneTimeRanges,
  formatV2InputBlock,
  buildLivestreamV2UserPrompt,
} from '../lib/livestream/scriptPromptV2';
import { DEFAULT_V2_INPUT } from '../lib/livestream/v2Store';
import type { AidaStage } from '../lib/livestream/types';

const ORDER: AidaStage[] = ['attention', 'interest', 'desire', 'action'];

for (let n = 1; n <= 40; n += 1) {
  const stages = allocateAidaStages(n);

  assert.equal(stages.length, n, `n=${n}: phải trả đúng ${n} cảnh, nhận ${stages.length}`);

  // Thứ tự A→I→D→A không bao giờ đảo: index trong ORDER phải không giảm.
  let prev = -1;
  for (const s of stages) {
    const idx = ORDER.indexOf(s);
    assert.ok(idx >= prev, `n=${n}: giai đoạn đảo ngược tại "${s}" (${stages.join(',')})`);
    prev = idx;
  }

  // Cảnh đầu luôn là hook, cảnh cuối luôn là CTA — thiếu 1 trong 2 là hỏng kịch bản bán hàng.
  assert.equal(stages[0], 'attention', `n=${n}: cảnh đầu phải là attention`);
  if (n >= 2) {
    assert.equal(stages[n - 1], 'action', `n=${n}: cảnh cuối phải là action`);
  }

  // Từ 4 cảnh trở lên phải đủ cả 4 giai đoạn.
  if (n >= 4) {
    for (const stage of ORDER) {
      assert.ok(stages.includes(stage), `n=${n}: thiếu giai đoạn ${stage} (${stages.join(',')})`);
    }
  }
}

// Mốc 10 cảnh (mặc định của skill): tỉ lệ phải nằm trong khoảng skill quy định.
{
  const stages = allocateAidaStages(10);
  const count = (s: AidaStage) => stages.filter((x) => x === s).length;
  assert.ok(count('attention') >= 2 && count('attention') <= 3, `attention=${count('attention')}`);
  assert.ok(count('interest') >= 3 && count('interest') <= 4, `interest=${count('interest')}`);
  assert.ok(count('desire') >= 3 && count('desire') <= 4, `desire=${count('desire')}`);
  assert.ok(count('action') >= 2 && count('action') <= 3, `action=${count('action')}`);
}

// Mốc thời gian phải liền mạch, không hở không chồng.
{
  const ranges = sceneTimeRanges([8, 8, 6]);
  assert.deepEqual(ranges, [
    { from: 0, to: 8 },
    { from: 8, to: 16 },
    { from: 16, to: 22 },
  ]);
}

// Không có khuyến mãi → prompt PHẢI cấm bịa giá (STEP 10 của skill).
{
  const block = formatV2InputBlock(DEFAULT_V2_INPUT);
  assert.ok(/KHÔNG nhắc tới giá/.test(block), 'thiếu chặn bịa giá khi không có khuyến mãi');
  assert.ok(!/undefined|NaN/.test(block), 'block lọt giá trị rỗng không mong muốn');
}

// Có khuyến mãi → phải xuất hiện nguyên văn, và KHÔNG kèm câu cấm nhắc giá (mâu thuẫn nhau).
{
  const block = formatV2InputBlock({ ...DEFAULT_V2_INPUT, promotion: 'Mua 1 tặng 1' });
  assert.ok(block.includes('Mua 1 tặng 1'), 'khuyến mãi không lọt vào prompt');
  assert.ok(!/KHÔNG nhắc tới giá/.test(block), 'vừa cho khuyến mãi vừa cấm nhắc giá');
}

// User prompt phải có đủ bảng cảnh + trần số từ cho MỌI cảnh.
{
  const prompt = buildLivestreamV2UserPrompt('Bông tắm tròn tạo bọt', [8, 8, 8, 8], {
    ...DEFAULT_V2_INPUT,
    advantages: ['Tạo bọt tốt', 'Bề mặt mềm'],
  });
  for (let i = 1; i <= 4; i += 1) {
    assert.ok(prompt.includes(`Cảnh ${i} —`), `thiếu cảnh ${i} trong bảng`);
  }
  assert.ok(prompt.includes('Tạo bọt tốt'), 'ưu điểm không lọt vào prompt');
  assert.ok(prompt.includes('tối đa 22 từ'), 'thiếu trần số từ (8s → 22 từ)');
  assert.ok(prompt.includes('ĐÚNG 3 câu thoại'), 'thiếu ràng buộc số câu thoại');
}

// Sản phẩm thứ 2 trở đi: cấm chào lại (giữ liền mạch buổi live như V1).
{
  const prompt = buildLivestreamV2UserPrompt('SP2', [8, 8], DEFAULT_V2_INPUT, undefined, undefined, {
    index: 1,
    total: 3,
    prevProductName: 'SP1',
  });
  assert.ok(prompt.includes('KHÔNG chào lại khán giả'), 'thiếu chặn chào lại giữa buổi live');
  assert.ok(prompt.includes('SP1'), 'thiếu tên sản phẩm trước để viết câu chuyển tiếp');
}

console.log('✅ check-aida-allocation: OK');
