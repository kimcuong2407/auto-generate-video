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
 * Ranh giới cần giữ:
 * - resolveFlowProjectIdSafe phải LOG lý do trước khi trả null (không catch trống).
 * - ensureProjectFlowId / ensureJobFlowId phải THROW nguyên nhân thật, không trả null xuống
 *   cho caller dịch thành thông điệp sai.
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
    /Tài khoản Veo/.test(body),
    `${fnName}: thông điệp lỗi phải chỉ chỗ sửa (Cài đặt → Tài khoản Veo), không chỉ báo "thiếu id"`
  );
}

console.log('check-flow-project-error: OK');
