/**
 * Self-check cho cổng dừng-chờ duyệt từng bước AI (lib/livestream/stepGate.ts).
 *
 * Thứ dễ hỏng nhất ở đây là RÒ WAITER: mỗi cổng giữ một promise chưa resolve + một setTimeout.
 * Resolve hai lần, hoặc quên xoá khỏi Map, hoặc quên clearTimeout thì request treo / process
 * không thoát. Check này ép đúng các đường đó.
 */
import assert from 'node:assert/strict';
import { waitForConfirm, resolveGate, abandonGates } from '../lib/livestream/stepGate';

async function main() {
  // 1. Duyệt chạy: promise phải resolve đúng 'run'.
  const a = waitForConfirm({ stepKey: 'script', label: 'Sinh kịch bản', prompt: 'xin chào' });
  assert.equal(resolveGate(a.gateId, 'run'), true, 'resolveGate phải tìm thấy cổng vừa mở');
  assert.equal(await a.promise, 'run');

  // 2. Cổng đã trả lời thì KHÔNG trả lời lại được — nếu không, bấm 2 lần sẽ đẩy stream đi 2 bước.
  assert.equal(resolveGate(a.gateId, 'skip'), false, 'cổng đã resolve phải bị xoá khỏi Map');

  // 3. Bỏ qua bước.
  const b = waitForConfirm({ stepKey: 'shorten', label: 'Rút gọn', prompt: '' });
  assert.equal(resolveGate(b.gateId, 'skip'), true);
  assert.equal(await b.promise, 'skip');

  // 4. gateId lạ (hết giờ / request đã đứt) → false, để route trả 409 thay vì im lặng nuốt.
  assert.equal(resolveGate('gate-khong-ton-tai', 'run'), false);

  // 5. gateId phải DUY NHẤT: hai cổng mở liên tiếp mà trùng id thì cổng sau ghi đè cổng trước
  //    trong Map, cổng trước treo vĩnh viễn.
  const c = waitForConfirm({ stepKey: 'stage_bible', label: 'Sân khấu', prompt: 'x' });
  const d = waitForConfirm({ stepKey: 'script_qa', label: 'QA', prompt: 'y' });
  assert.notEqual(c.gateId, d.gateId, 'gateId phải duy nhất');

  // 6. Client ngắt kết nối giữa chừng → abandonGates giải phóng mọi cổng còn treo.
  abandonGates([c.gateId, d.gateId]);
  assert.equal(await c.promise, 'skip');
  assert.equal(await d.promise, 'skip');
  assert.equal(resolveGate(c.gateId, 'run'), false, 'cổng đã abandon phải rời khỏi Map');

  // 7. abandonGates với id lạ không được ném — client ngắt sau khi mọi bước đã duyệt xong là
  //    đường chạy bình thường, không phải lỗi.
  abandonGates(['gate-khong-ton-tai', c.gateId]);

  console.log('✅ check-step-gate: OK');
  // Không còn timer nào treo thì process tự thoát ở đây. Treo = có setTimeout chưa clear.
}

main();
