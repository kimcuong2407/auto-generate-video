/**
 * Self-check: lỗi thiếu Flow project phải nói ĐÚNG nguyên nhân, không nuốt lỗi gốc.
 *
 * Vì sao cần (bug 2026-09-11, step gen video "8s · zoom_in · veo_3_1_lite"): người dùng thấy
 * "Chưa có flowProjectId — cần tạo Flow project trước khi gen video" — thông điệp vừa sai
 * (người dùng không tự tạo Flow project được) vừa giấu nguyên nhân thật. Chuỗi lỗi khi đó:
 *   resolveFlowProjectIdSafe `catch {}` trống nuốt FlowApiError ("Chưa cấu hình tài khoản
 *   Google Flow" / 401 cookie hết hạn) → trả null → ensureProjectFlowId trả null →
 *   generateSceneVideo throw thông điệp vô nghĩa. Không log nào để lần ra.
 *
 * CẬP NHẬT 2026-09-11 (bug thứ hai, cùng gốc): thông điệp khi đó đã hết vô nghĩa nhưng vẫn
 * ĐOÁN nguyên nhân — "chưa cấu hình tài khoản, hoặc cookie/token đã hết hạn, cần mở lại tab
 * Flow để extension gửi session". Lỗi thật lại là Google gỡ endpoint labs.google/fx/api/trpc
 * (xem lib/googleFlow/projects.ts), tài khoản hoàn toàn bình thường. Mr.D gửi lại session
 * nhiều lần vô ích vì thông điệp chỉ sai chỗ. Nên nay bắt buộc GHÉP lý do gốc
 * (lastCreateFlowProjectError) thay vì hardcode một nguyên nhân phỏng đoán.
 *
 * Ranh giới cần giữ:
 * - resolveFlowProjectIdSafe phải LOG lý do trước khi trả null (không catch trống) và GIỮ
 *   lại lý do đó cho caller đọc.
 * - ensureProjectFlowId / ensureJobFlowId phải THROW nguyên nhân thật, không trả null xuống
 *   cho caller dịch thành thông điệp sai, và không được tự đoán nguyên nhân.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// --- resolveFlowProjectIdSafe: catch phải log, không được nuốt im lặng.
{
  const src = read('lib/googleFlow/flowJobs.ts');
  const fn = src.slice(src.indexOf('export async function resolveFlowProjectIdSafe'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);

  assert.ok(
    !/catch\s*\{\s*\n?\s*return null;/.test(body),
    'resolveFlowProjectIdSafe có catch trống nuốt lỗi — phải log lý do gốc trước khi trả null'
  );
  assert.ok(
    /catch\s*\(\s*err\s*\)/.test(body) && /console\.error/.test(body),
    'resolveFlowProjectIdSafe phải bắt err và console.error lý do (kèm code lỗi) để còn điều tra'
  );
  // Log ra console là chưa đủ: log nằm trên VPS, người bấm nút không đọc được. Lý do phải
  // giữ lại để caller ghép vào thông điệp hiện trên UI.
  assert.ok(
    /lastFlowProjectError\s*=/.test(body),
    'resolveFlowProjectIdSafe phải giữ lý do gốc vào lastFlowProjectError cho caller đọc'
  );
  assert.ok(
    /export function lastCreateFlowProjectError/.test(src),
    'flowJobs.ts phải export lastCreateFlowProjectError() để caller lấy lý do thật'
  );
}

// --- ensure*FlowId: throw nguyên nhân thật thay vì trả null.
for (const [file, fnName] of [
  ['lib/data/projectStore.ts', 'ensureProjectFlowId'],
  ['lib/livestream/jobStore.ts', 'ensureJobFlowId'],
] as const) {
  const src = read(file);
  const at = src.indexOf(`export async function ${fnName}`);
  assert.ok(at !== -1, `${file}: không tìm thấy ${fnName}`);
  const fn = src.slice(at);
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);

  assert.ok(
    /Promise<string>/.test(body),
    `${fnName} phải trả Promise<string> — trả null khiến caller báo "Chưa có flowProjectId" thay vì lý do thật`
  );
  assert.ok(
    /throw new FlowApiError/.test(body),
    `${fnName} phải throw FlowApiError khi không tạo được Flow project`
  );
  assert.ok(
    /lastCreateFlowProjectError\(\)/.test(body),
    `${fnName}: thông điệp lỗi phải ghép lý do GỐC qua lastCreateFlowProjectError(), không tự đoán`
  );
  // Chốt chặn chống tái phát: thông điệp không được hardcode một nguyên nhân phỏng đoán.
  // Đúng câu này từng bắt Mr.D gửi lại session nhiều lần trong khi lỗi nằm ở endpoint đã chết.
  assert.ok(
    !/cookie\/token đã hết hạn/.test(body),
    `${fnName}: không được đoán "cookie/token đã hết hạn" — phải lấy lý do thật từ Flow API`
  );
}

console.log('check-flow-project-error: OK');
