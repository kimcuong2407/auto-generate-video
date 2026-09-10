/**
 * Self-check: log AI của 2 luồng (livestream vs review) không được lẫn vào nhau.
 *
 * Vì sao cần: ai_call_logs phục vụ CẢ hai luồng, phân biệt bằng cặp (job_slug, project_id) —
 * livestream ghi (slug, ''), review ghi ('', projectId). Bỏ sót một cột trong WHERE là hỏng theo
 * hai kiểu, cả hai đều âm thầm:
 *   - Bỏ project_id khi ĐỌC  → job livestream thấy luôn log của mọi project review.
 *   - Bỏ project_id khi CẮT  → mọi project dồn chung nhóm job_slug='' rồi cắt lẫn nhau, vừa mất
 *     log vừa để nhóm đó phình theo số project. Đúng cái bẫy doc-comment của bảng đã cảnh báo.
 *
 * Kiểm bằng cách đọc mã nguồn: 2 chỗ này là truy vấn DB nên không dựng lại được bằng hàm thuần,
 * mà chạy thật thì cần DB — check phải chạy được ở CI không có DB.
 *
 * Chạy: npx tsx scripts/check-ai-log-scope.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 1. pruneAiCallLogs: scope cắt tỉa phải gồm CẢ project_id.
{
  const src = fs.readFileSync('lib/ai/callLog.ts', 'utf8');
  const fn = src.slice(src.indexOf('async function pruneAiCallLogs'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /eq\(aiCallLogs\.jobSlug,\s*jobSlug\)/, 'phải lọc theo jobSlug');
  assert.match(body, /eq\(aiCallLogs\.projectId,\s*projectId\)/, 'PHẢI lọc theo projectId, nếu không log mọi project cắt lẫn nhau');
  assert.match(body, /eq\(aiCallLogs\.stepKey,\s*stepKey\)/, 'phải lọc theo bước');
}

// 2. recordAiCall nhận projectId, và chatClient truyền nó xuống — thiếu mắt xích nào thì cột
//    project_id luôn rỗng và toàn bộ tính năng thành vô nghĩa mà không có lỗi nào.
{
  const callLog = fs.readFileSync('lib/ai/callLog.ts', 'utf8');
  assert.match(callLog, /export async function recordAiCall\(row: \{[\s\S]*?projectId: string;/, 'recordAiCall phải nhận projectId');
  assert.match(callLog, /export interface AiCallContext \{[\s\S]*?projectId\?: string;/, 'AiCallContext phải có projectId');

  const chat = fs.readFileSync('lib/ai/chatClient.ts', 'utf8');
  assert.match(chat, /projectId: ctx\.projectId \?\? ''/, 'chatClient phải truyền projectId xuống recordAiCall');
}

// 3. Route đọc log: project_id luôn nằm trong WHERE, kể cả khi rỗng.
{
  const route = fs.readFileSync('app/api/ai-logs/route.ts', 'utf8');
  assert.match(route, /searchParams\.get\('projectId'\)/, 'route phải nhận query projectId');
  assert.match(route, /eq\(aiCallLogs\.projectId,\s*projectId\)/, 'WHERE phải có projectId, nếu không 2 luồng đọc chéo nhau');
}

// 4. Ba chỗ gọi AI của luồng review đều phải gắn nhãn projectId. Quên chỗ nào thì lượt đó rơi
//    khỏi log im lặng — chatClient bỏ qua lượt không có nhãn, không báo lỗi.
{
  const cases: [string, string][] = [
    ['lib/data/veoPromptEvaluate.ts', 'veo_prompt_eval'],
    ['lib/data/storyboardPromptGenerate.ts', 'storyboard_prompt'],
    ['lib/data/productVisionExtract.ts', 'product_visual'],
    ['app/api/projects/[id]/script/generate/route.ts', 'script'],
  ];
  for (const [file, stepKey] of cases) {
    const src = fs.readFileSync(file, 'utf8');
    assert.match(src, /withAiCallContext\(/, `${file} phải bọc withAiCallContext`);
    assert.ok(src.includes(`stepKey: '${stepKey}'`), `${file} phải gắn stepKey '${stepKey}'`);
    assert.match(src, /projectId[,:]/, `${file} phải truyền projectId`);
  }
}

// 5. Migration phải dùng IF NOT EXISTS — production đã có schema drift (cột thêm tay), chạy
//    ALTER trần lên đó là fail giữa deploy.
{
  const sql = fs.readFileSync('lib/db/migrations/0023_script_evaluation_and_project_log.sql', 'utf8');
  const ddl = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const stmts = ddl.split(';').filter((x) => /ALTER TABLE|CREATE INDEX/i.test(x));
  assert.equal(stmts.length, 3, 'migration phải có đúng 3 câu DDL');
  for (const st of stmts) {
    assert.match(st, /IF NOT EXISTS/i, `câu DDL phải có IF NOT EXISTS: ${st.trim().slice(0, 70)}`);
  }
  // Chỉ soi phần DDL: doc-comment của file có NHẮC chữ "CREATE TABLE" để giải thích vì sao không
  // dùng db:generate — soi cả comment thì bắt nhầm chính lời cảnh báo đó.
  assert.doesNotMatch(ddl, /CREATE TABLE/i, 'KHÔNG được có CREATE TABLE — 3 bảng đó đã tồn tại trên DB thật');
}

console.log('✅ check-ai-log-scope: 5/5 pass');
