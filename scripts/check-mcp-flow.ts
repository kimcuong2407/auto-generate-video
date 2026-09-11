/**
 * Self-check luồng Orino MCP (assert thuần, không framework).
 *
 * Kiểm 3 nhóm, đều là chỗ đã hoặc dễ sai:
 *  1. Parse body SSE — server trả `data: {...}`, JSON.parse thẳng là hỏng.
 *  2. Ánh xạ tham số sang schema Orino (snake_case, end_path cần start_path).
 *  3. Cờ tắt = luồng cũ nguyên vẹn (không có nhánh MCP nào chạy khi useMcp=false).
 *
 * Chạy: npx tsx scripts/check-mcp-flow.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// ---------- 1. Parse body SSE ----------
// Bản sao logic parseRpcBody (hàm private trong mcpClient.ts) — kiểm đúng quy tắc bóc `data:`.
function parseRpcBody(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.startsWith('data:') ? rawLine.slice(5).trim() : rawLine.trim();
    if (!line.startsWith('{')) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      /* dòng chưa trọn vẹn */
    }
  }
  return out;
}

console.log('1. Parse body SSE/JSON');
check('bóc được tiền tố "data:" của SSE', () => {
  const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n';
  const msgs = parseRpcBody(body);
  assert.equal(msgs.length, 1);
  assert.equal((msgs[0] as { id: number }).id, 1);
});
check('đọc được JSON thuần (không SSE)', () => {
  const msgs = parseRpcBody('{"jsonrpc":"2.0","id":9,"result":{}}');
  assert.equal(msgs.length, 1);
  assert.equal((msgs[0] as { id: number }).id, 9);
});
check('bỏ qua dòng rác, không ném', () => {
  const msgs = parseRpcBody(': ping\ndata: khong-phai-json\ndata: {"id":3}\n');
  assert.equal(msgs.length, 1);
  assert.equal((msgs[0] as { id: number }).id, 3);
});
check('body rỗng trả mảng rỗng (caller tự báo lỗi, không crash)', () => {
  assert.deepEqual(parseRpcBody(''), []);
});

// ---------- 2. Ánh xạ tham số sang schema Orino ----------
// Bản sao quy tắc dựng args trong generateSceneVideoMcp.
function buildVideoArgs(opts: {
  aspect: string;
  model: string;
  flowProjectId?: string | null;
  refImages?: { path: string }[];
  startImage?: { path: string };
  endImage?: { path: string };
}, prompt: string, duration: number): Record<string, unknown> {
  const args: Record<string, unknown> = { prompt, aspect: opts.aspect, model: opts.model, duration };
  if (opts.flowProjectId) args.project_id = opts.flowProjectId;
  if (opts.refImages?.length) args.ref_paths = opts.refImages.map((r) => r.path);
  if (opts.startImage) args.start_path = opts.startImage.path;
  if (opts.endImage && opts.startImage) args.end_path = opts.endImage.path;
  return args;
}

console.log('2. Ánh xạ tham số sang schema Orino');
// Enum lấy từ schema THẬT của flow_generate_video (dump 2026-09-11), không phải phỏng đoán.
const ORINO_VIDEO_KEYS = ['prompt', 'aspect', 'duration', 'model', 'project_id', 'ref_paths', 'start_path', 'end_path'];
const ORINO_MODELS = ['veo_3_1_quality', 'veo_3_1_fast', 'veo_3_1_lite', 'veo_3_1_lite_low_priority', 'abra'];

check('mọi key gửi đi đều có trong schema Orino', () => {
  const args = buildVideoArgs(
    { aspect: '9:16', model: 'abra', flowProjectId: 'p1', refImages: [{ path: '/a.png' }], startImage: { path: '/s.png' }, endImage: { path: '/e.png' } },
    'xin chào',
    8
  );
  for (const k of Object.keys(args)) {
    assert.ok(ORINO_VIDEO_KEYS.includes(k), `key "${k}" không có trong schema flow_generate_video`);
  }
});
check('end_path bị bỏ khi thiếu start_path (schema: "needs start_path too")', () => {
  const args = buildVideoArgs({ aspect: '16:9', model: 'veo_3_1_fast', endImage: { path: '/e.png' } }, 'p', 8);
  assert.equal(args.end_path, undefined);
  assert.equal(args.start_path, undefined);
});
check('end_path được gửi khi có start_path', () => {
  const args = buildVideoArgs(
    { aspect: '16:9', model: 'veo_3_1_fast', startImage: { path: '/s.png' }, endImage: { path: '/e.png' } },
    'p',
    8
  );
  assert.equal(args.start_path, '/s.png');
  assert.equal(args.end_path, '/e.png');
});
check('không gửi project_id rỗng (Orino hiểu là "tạo project mới")', () => {
  const args = buildVideoArgs({ aspect: '16:9', model: 'veo_3_1_fast', flowProjectId: '' }, 'p', 8);
  assert.ok(!('project_id' in args));
});
check('VEO_MODELS của repo khớp enum model của Orino', () => {
  const src = readFileSync(new URL('../lib/types.ts', import.meta.url), 'utf8');
  for (const m of ORINO_MODELS) {
    assert.ok(src.includes(`'${m}'`), `VEO_MODELS thiếu "${m}" — không gửi được tier này qua MCP`);
  }
});

// ---------- 3. Cờ tắt = luồng cũ nguyên vẹn ----------
console.log('3. Cờ tắt thì luồng cũ không đổi');
const flowJobsSrc = readFileSync(new URL('../lib/googleFlow/flowJobs.ts', import.meta.url), 'utf8');

check('useMcp mặc định false trong appSettingsStore', () => {
  const src = readFileSync(new URL('../lib/data/appSettingsStore.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('useMcp: data.useMcp === true'), 'phải parse tường minh === true');
  assert.ok(src.includes('useMcp: false'), 'fallback khi đọc file lỗi phải là false');
});
check('mọi nhánh MCP đều đứng sau guard useMcp()', () => {
  // Guard có thể ở cùng dòng (`if (useMcp()) return xMcp(...)`) hoặc dòng ngay trên
  // (`if (useMcp()) {` rồi `return xMcp(...)`). Xét 3 dòng gần nhất là đủ phủ cả hai dạng mà
  // vẫn bắt được lời gọi trần — nếu nới rộng nữa thì một guard ở xa sẽ "che" nhầm.
  const lines = flowJobsSrc.split('\n');
  const importBlock = flowJobsSrc.slice(0, flowJobsSrc.indexOf("} from './mcpJobs';"));
  lines.forEach((line, i) => {
    const m = line.match(/\b(getFlowStatusMcp|createFlowProjectMcp|generateSceneVideoMcp|pollJobStatusMcp|generateStoryboardImageMcp)\(/);
    if (!m) return;
    if (importBlock.includes(line) && !line.includes('return')) return; // dòng trong khối import
    const window = lines.slice(Math.max(0, i - 2), i + 1).join(' ');
    assert.ok(window.includes('useMcp()'), `gọi ${m[1]} không có guard useMcp() trong 3 dòng gần nhất: ${line.trim()}`);
  });
});

check('4 cửa nghiệp vụ đều có nhánh MCP', () => {
  for (const fn of ['getFlowStatusMcp', 'createFlowProjectMcp', 'pollJobStatusMcp', 'generateSceneVideoMcp', 'generateStoryboardImageMcp']) {
    assert.ok(flowJobsSrc.includes(`${fn}(`), `flowJobs.ts chưa nối ${fn}`);
  }
});
check('nhánh MCP của gen video đứng SAU khi dựng prompt (giữ logic tiếng Việt/no-subtitles)', () => {
  const iPrompt = flowJobsSrc.indexOf('appendNegativePrompt(prompt');
  const iMcp = flowJobsSrc.indexOf('generateSceneVideoMcp(');
  assert.ok(iPrompt > 0 && iMcp > iPrompt, 'rẽ MCP trước khi dựng prompt là mất chỉ dẫn thoại tiếng Việt');
});
check('nhánh MCP của gen ảnh đứng SAU nhánh ChatGPT/OmniRoute', () => {
  const iOmni = flowJobsSrc.indexOf('generateOmniImage(');
  const iMcp = flowJobsSrc.indexOf('generateStoryboardImageMcp(');
  assert.ok(iOmni > 0 && iMcp > iOmni, 'cờ MCP không được cướp luồng ảnh của provider khác');
});
check('gen video không đụng cookie/reCAPTCHA khi đi MCP', () => {
  const body = flowJobsSrc.slice(flowJobsSrc.indexOf('export async function generateSceneVideo('));
  const iMcp = body.indexOf('generateSceneVideoMcp(');
  const iCreds = body.indexOf('flowCredsOf(account)');
  assert.ok(iMcp < iCreds, 'nhánh MCP phải đứng trước flowCredsOf — nếu không sẽ đòi cookie dù không dùng');
});

check('tên biến env trong code khớp .env.example (bẫy đã mắc: ORINO_MCP_* vs ORINO_FLOW_MCP_*)', () => {
  const client = readFileSync(new URL('../lib/googleFlow/mcpClient.ts', import.meta.url), 'utf8');
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const used = [...client.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'mcpClient không đọc biến env nào — sai');
  for (const name of used) {
    assert.ok(example.includes(name), `code đọc ${name} nhưng .env.example không khai báo → bật cờ lên là lỗi "chưa cấu hình"`);
  }
});

// ---------- 4. Cascade không đứt khi đi MCP ----------
console.log('4. Cascade / retry khi đi MCP');
const mcpJobsSrc = readFileSync(new URL('../lib/googleFlow/mcpJobs.ts', import.meta.url), 'utf8');
const sceneGenSrc = readFileSync(new URL('../lib/data/sceneGenerate.ts', import.meta.url), 'utf8');
const sceneSyncSrc = readFileSync(new URL('../lib/data/sceneSync.ts', import.meta.url), 'utf8');

check('video từ MCP được copy về tmp của repo (không trả thẳng path Orino)', () => {
  // Trả thẳng path Orino → sceneSync.copyFile lỗi → scene kẹt generating → justDoneSceneIds
  // rỗng → cascade sang cảnh kế KHÔNG chạy. Đây là bug đã sửa, khoá lại.
  const fn = mcpJobsSrc.slice(mcpJobsSrc.indexOf('export async function pollJobStatusMcp'));
  assert.ok(fn.includes('TMP_VIDEO_DIR'), 'pollJobStatusMcp phải copy video về TMP_VIDEO_DIR của repo');
  assert.ok(fn.includes('fs.copyFile'), 'phải copyFile, không trả thẳng res.video_path');
  const iCopy = fn.indexOf('fs.copyFile');
  const iReturn = fn.indexOf("return { status: 'done'");
  assert.ok(iCopy > 0 && iCopy < iReturn, 'copy phải xảy ra TRƯỚC khi trả done');
  assert.ok(!/video_path: res\.video_path/.test(fn), 'không được trả path gốc của Orino');
});
check('isMcpUnavailableError nhận diện đúng câu lỗi mcpClient sinh ra', () => {
  const clientSrc = readFileSync(new URL('../lib/googleFlow/mcpClient.ts', import.meta.url), 'utf8');
  const errSrc = readFileSync(new URL('../lib/googleFlow/errors.ts', import.meta.url), 'utf8');
  // Câu chữ trong mcpClient và regex trong errors phải khớp nhau, nếu không thì đổi lời báo lỗi
  // một chỗ là hàm nhận diện câm lặng trả false và attempts lại bị đốt.
  for (const phrase of ['Không gọi được Orino MCP', 'Chưa cấu hình ORINO_FLOW_MCP_TOKEN']) {
    assert.ok(clientSrc.includes(phrase), `mcpClient không còn sinh câu "${phrase}"`);
    assert.ok(errSrc.includes(phrase), `isMcpUnavailableError không bắt câu "${phrase}"`);
  }
});
check('lỗi MCP chết KHÔNG tính vào attempts (như hết quota)', () => {
  assert.ok(
    /if \(!quota && !mcpDown\) s\.attempts \+= 1;/.test(sceneGenSrc),
    'attempts phải bỏ qua cả quota lẫn mcpDown — nếu không, Orino tắt vài phút là đốt sạch trần retry'
  );
});
check('cascade và resume đều dừng gọn khi MCP chết', () => {
  assert.ok(sceneSyncSrc.includes('res.mcpUnavailable'), 'cascade phải xét res.mcpUnavailable');
  const chaining = sceneSyncSrc.slice(sceneSyncSrc.indexOf('export async function runChainingForJustDone'));
  assert.ok(chaining.includes('mcpUnavailable'), 'runChainingForJustDone phải dừng khi MCP chết');
});
check('shouldAutoTrigger vẫn cho cảnh failed được thử lại trong trần', () => {
  // Bảo đảm cơ chế tự retry Mr.D yêu cầu vẫn còn nguyên sau các sửa đổi trên.
  assert.ok(sceneSyncSrc.includes('MAX_SEGMENT_AUTO_RETRIES'), 'mất trần retry');
  assert.ok(sceneSyncSrc.includes('SEGMENT_RETRY_BACKOFF_MS'), 'mất backoff');
  const fn = sceneSyncSrc.slice(sceneSyncSrc.indexOf('export function shouldAutoTrigger'));
  assert.ok(/status === 'idle'\) return true/.test(fn), 'cảnh idle phải được trigger');
  // Sau khi thêm log lý do, nhánh này trả qua why(...) thay vì `return false` trực tiếp — vẫn
  // phải là false, chỉ khác cách viết.
  assert.ok(/status !== 'failed'\) return why\(/.test(fn), 'chỉ idle/failed mới auto-trigger');
  assert.ok(/const why = \(reason/.test(fn), 'why() phải trả false và ghi log lý do');
  assert.ok(/return false;\n  };/.test(fn), 'why() phải kết thúc bằng return false');
});

console.log(`\n✅ ${passed} assert passed`);
