/**
 * Self-check: payload + parse response của rpc tạo Flow project (jHPbke).
 *
 * Vì sao cần: payload Google Flow là MẢNG LỒNG không tên trường, mọi thứ định vị bằng chỉ số
 * đọc từ HAR. Đặt title sai lớp lồng thì Google vẫn trả 200 nhưng project mang tên rỗng —
 * hỏng âm thầm, không có lỗi nào chỉ ra chỗ sai. Các assert dưới khoá đúng hình dạng đã xác
 * minh trong docs/create-project-flow.google.com.har (2026-09-11) và đã gọi thật nhận 200.
 *
 * Chạy: npx tsx scripts/check-flow-create-project.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RPC_CREATE_PROJECT,
  buildCreateProjectPayload,
  parseCreateProjectResponse,
} from '../lib/googleFlow/projects';
import { FlowApiError } from '../lib/googleFlow/errors';

// ---------------------------------------------------------------
// 1. rpcid + payload khớp HAR.
// HAR f.req: [["jHPbke","[\"projects/*\",[null,[\"Sep 11 - 11:31\"]],[null,22]]",null,"generic"]]
// ---------------------------------------------------------------
assert.equal(RPC_CREATE_PROJECT, 'jHPbke', 'rpcid tạo project phải là jHPbke (HAR 2026-09-11)');

const payload = buildCreateProjectPayload('Sep 11 - 11:31');
assert.equal(payload[0], 'projects/*', 'vị trí [0] phải là "projects/*"');
assert.deepEqual(payload[1], [null, ['Sep 11 - 11:31']], 'title phải lồng ở [1][1][0]');
assert.deepEqual(payload[2], [null, 22], 'mã tool PINHOLE (22) phải ở [2][1]');

// Serialize ra đúng chuỗi HAR — chốt chặn cuối, bắt mọi sai lệch hình dạng.
assert.equal(
  JSON.stringify(payload),
  '["projects/*",[null,["Sep 11 - 11:31"]],[null,22]]',
  'payload serialize phải khớp từng ký tự với HAR'
);

// Title có ký tự cần escape (tên project tiếng Việt có dấu ngoặc kép) không được làm vỡ shape.
const quoted = buildCreateProjectPayload('Hộp "Gấu" Homebox');
assert.deepEqual(quoted[1], [null, ['Hộp "Gấu" Homebox']], 'title có dấu nháy vẫn phải đúng lớp');

// ---------------------------------------------------------------
// 2. Parse response.
// HAR: ["ce14da13-8a7d-4127-8512-11b0a29c5a28",["Sep 11 - 11:31"]]
// ---------------------------------------------------------------
const ok = parseCreateProjectResponse(
  ['ce14da13-8a7d-4127-8512-11b0a29c5a28', ['Sep 11 - 11:31']],
  'fallback'
);
assert.equal(ok.id, 'ce14da13-8a7d-4127-8512-11b0a29c5a28', 'projectId đọc ở [0]');
assert.equal(ok.title, 'Sep 11 - 11:31', 'title đọc ở [1][0]');

// Google đổi layout / trả rỗng → phải ném lỗi NÓI RÕ, không trả id rỗng xuống dưới. Trả id
// rỗng thì project được lưu với flowProjectId = "" và mọi lệnh gen sau đó hỏng khó hiểu.
for (const bad of [[], [null, ['x']], ['', ['x']], null, 'chuỗi', [123]]) {
  assert.throws(
    () => parseCreateProjectResponse(bad, 'fallback'),
    FlowApiError,
    `response ${JSON.stringify(bad)} phải ném FlowApiError, không được nuốt`
  );
}

// Thiếu title trong response vẫn dùng được — chỉ id là bắt buộc.
assert.equal(parseCreateProjectResponse(['id-1'], 'tên dự phòng').title, 'tên dự phòng');
assert.equal(parseCreateProjectResponse(['id-1', []], 'tên dự phòng').title, 'tên dự phòng');

// ---------------------------------------------------------------
// 3. Không còn gọi endpoint đã chết.
// labs.google/fx/api/trpc bị Google gỡ: probe thật với cookie CÒN HIỆU LỰC vẫn trả 401
// UNAUTHORIZED, và labs.google/fx/* nay 308 sang flow.google.com.
// ---------------------------------------------------------------
const src = readFileSync(new URL('../lib/googleFlow/projects.ts', import.meta.url), 'utf8');
// Bỏ comment trước khi soi: phần ghi chú lịch sử CỐ Ý nhắc tên endpoint đã chết, quét cả
// comment thì self-check tự báo động vì chính tài liệu giải thích nó.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
assert.ok(
  !/labsRequest\s*\(/.test(code),
  'projects.ts không được gọi lại labsRequest (labs.google/fx/api/trpc) — endpoint đã bị Google gỡ (401 dù cookie còn tốt)'
);
assert.ok(
  !/['"`][^'"`]*\/fx\/api\/trpc/.test(code),
  'projects.ts không được nhắc tới path /fx/api/trpc trong code — endpoint đã chết'
);
assert.ok(
  /batchExecute/.test(src),
  'projects.ts phải đi qua batchExecute trên flow.google.com như flowRpc.ts'
);

console.log('check-flow-create-project: OK');
