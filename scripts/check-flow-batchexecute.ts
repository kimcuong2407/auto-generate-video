/**
 * Self-check cho parser BatchExecute (lib/googleFlow/client.ts → parseBatchExecute).
 *
 * Vì sao cần: Google đã gỡ kiến trúc access_token + aisandbox-pa.googleapis.com (2026-09),
 * mọi thứ chuyển sang batchexecute với response format lạ — có prefix chống-JSON-hijack,
 * xen kẽ dòng độ dài, và payload là JSON LỒNG trong JSON. Parse sai một lớp là toàn bộ
 * pipeline câm lặng trả undefined.
 *
 * Fixture dưới đây là response THẬT cắt từ docs/flow.google.com.har (2026-09-04).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBatchExecute, __testables } from '../lib/googleFlow/client';

// --- Fixture 1: RPC trả mảng rỗng (mrlkwd) + có envelope rác (di, af.httprm) đi kèm.
const MRLKWD = ")]}'\n\n108\n[[\"wrb.fr\",\"mrlkwd\",\"[]\",null,null,null,\"generic\"],[\"di\",270],[\"af.httprm\",269,\"-1281567336308385754\",50]]\n25\n[[\"e\",4,null,null,144]]\n";

{
  const out = parseBatchExecute(MRLKWD, 'mrlkwd');
  assert.deepEqual(out, [], 'payload rỗng phải parse ra mảng rỗng, không phải chuỗi "[]"');
}

// --- Fixture 2: payload lồng sâu (o30O0e - thông tin user).
const O30 = ")]}'\n\n1058\n[[\"wrb.fr\",\"o30O0e\",\"[[[\\\"me\\\",1,[\\\"116842636000364273847\\\",[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,[null,[\\\"me\\\"]]],[[[true,0,true,null,null,null,null,null,\\\"116842636000364273847\\\",null,null,true,null,null,1],\\\"takudo Lam\\\",null,\\\"takudo\\\",\\\"Lam\\\",null,null,null,null,null,null,null,\\\"Lam, takudo\\\",null,null,\\\"takudo Lam\\\"]],[[[true,0,true,null,null,null,null,null,\\\"116842636000364273847\\\",null,null,null,null,null,1],\\\"https://lh3.googleusercontent.com/a/ACg8ocIYAEfp_RHVtY0KbuCZHdx4Ru6ElVERQoQvmt4RdVZYTKuXZQ\\\\u003dmo\\\",true,\\\"EhUxMTY4NDI2MzYwMDAzNjQyNzM4NDcoATDx8rPxAg\\\\u003d\\\\u003d\\\",null,null,true,\\\"33691E\\\"]],null,null,null,null,null,[[[null,0,true,null,null,null,null,null,\\\"116842636000364273847\\\",null,null,true,null,null,1],\\\"takudo24.2@gmail.com\\\",null,null,null,null,null,null,1,[true]]],null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,\\\"%EgMCAwkaAgEH\\\"],null,[]]]]\",null,null,null,\"generic\"],[\"di\",34],[\"af.httprm\",33,\"-7375174677591334177\",47]]\n26\n[[\"e\",4,null,null,1096]]\n";

{
  const out = parseBatchExecute(O30, 'o30O0e') as unknown[];
  assert.ok(Array.isArray(out), 'phải parse được lớp JSON lồng thứ hai');
  // Tên user nằm đâu đó trong cây — chỉ cần chứng minh đã bóc đúng 2 lớp JSON.
  assert.ok(JSON.stringify(out).includes('takudo'), 'nội dung thật phải còn nguyên sau parse');
}

// --- Chọn đúng rpcid khi 1 response chứa nhiều envelope.
{
  const multi = [
    ")]}\u0027",
    "42",
    JSON.stringify([
      ["wrb.fr", "aaa", JSON.stringify([1, 2])],
      ["wrb.fr", "bbb", JSON.stringify([3, 4])],
    ]),
  ].join('\n');
  assert.deepEqual(parseBatchExecute(multi, 'bbb'), [3, 4], 'phải lấy đúng envelope theo rpcid');
  assert.deepEqual(parseBatchExecute(multi, 'aaa'), [1, 2]);
}

// --- Cookie/at hết hạn: Google trả HTML đăng nhập → phải THROW, không trả undefined im lặng.
{
  assert.throws(
    () => parseBatchExecute('<!DOCTYPE html><html>Sign in</html>', 'mrlkwd'),
    /Không tìm thấy kết quả RPC/,
    'response không phải batchexecute phải báo lỗi rõ ràng'
  );
}

// --- Payload null (RPC thành công nhưng không có dữ liệu) không được nhầm thành lỗi.
{
  const nullish = [
    ")]}\u0027",
    "20",
    JSON.stringify([["wrb.fr", "zzz", null]]),
  ].join('\n');
  assert.equal(parseBatchExecute(nullish, 'zzz'), null);
}


// --- 401: message phải là hướng dẫn đọc được, không phải envelope thô của Google.
//
// Vì sao check: 401 là lỗi Flow hay gặp nhất (cookie bị Google thu hồi bất kỳ lúc nào), và
// trước đây nó rơi thẳng ra UI dưới dạng `HTTP 401: )]}' 107 [["er",...]]` — người dùng đọc
// xong tưởng code hỏng chứ không biết phải gửi lại session.
{
  const msg = __testables.unauthenticatedMessage();
  assert.ok(!msg.includes(')]}'), 'message 401 không được chứa envelope thô của Google');
  assert.ok(!/\[\["er"/.test(msg), 'message 401 không được chứa mảng lỗi nội bộ');
  assert.ok(msg.includes('flow.google.com'), 'phải chỉ rõ mở tab nào');
  assert.ok(/session/i.test(msg), 'phải nói rõ cách chữa là gửi lại session');
}

console.log('check-flow-batchexecute: OK');

// --- hl phải là en-US, khớp trang thật.
//
// XÁC MINH 2026-09-11 (docs/create-project-flow.google.com.har): MỌI request batchexecute của
// trang thật gửi hl=en-US — jHPbke, maseQ, eb1hJf, jwpduf, as29s đều vậy. Code từng gửi 'vi'
// theo suy đoán "app tiếng Việt thì gửi vi", không dựa HAR nào. Giữ đúng trang thật để khi
// Google từ chối request thì bớt được một biến phải loại trừ.
{
  const src = readFileSync(new URL('../lib/googleFlow/client.ts', import.meta.url), 'utf8');
  const line = src.split('\n').find((l) => /hl:\s*opts\.hl\s*\?\?/.test(l)) || '';
  assert.ok(line, 'không tìm thấy dòng đặt hl mặc định trong batchExecute');
  assert.ok(
    /'en-US'/.test(line),
    `hl mặc định phải là 'en-US' (khớp HAR), đang là: ${line.trim()}`
  );
}

console.log('check-flow-batchexecute (bổ sung hl): OK');
