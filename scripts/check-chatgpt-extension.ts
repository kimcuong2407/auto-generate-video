/**
 * Self-check luồng gen ảnh ChatGPT qua extension Chrome.
 *
 * Sai ở đây = job nằm chờ vĩnh viễn (worker này cướp job của worker kia), hoặc người dùng ngồi
 * chờ 11 phút timeout mới biết chưa mở Chrome. Cả hai chỉ lộ ra lúc chạy thật.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHATGPT_EXTENSION_MODEL,
  CHATGPT_LOCAL_MODEL,
  IMAGE_MODEL_OPTIONS,
} from '../lib/imageModels';
import {
  EXTENSION_STALE_MS,
  isExtensionOnline,
  lastExtensionPollAt,
  markExtensionPolled,
  __testables,
} from '../lib/chatgptImage/extensionPresence';

// ── Provider mới phải nằm trong dropdown, nếu không route ai-settings từ chối lưu ──────────
{
  const values = IMAGE_MODEL_OPTIONS.map((o) => o.value);
  assert.ok(values.includes(CHATGPT_EXTENSION_MODEL), 'provider extension chưa có trong dropdown');
  assert.equal(new Set(values).size, values.length, 'có option trùng value');

  // Nhánh rẽ ở flowJobs.ts kiểm hằng ChatGPT TRƯỚC khi kiểm dấu "/". Hai hằng này mà chứa "/"
  // thì thứ tự kiểm không còn ý nghĩa và chúng rơi nhầm sang nhánh OmniRoute.
  assert.ok(!CHATGPT_EXTENSION_MODEL.includes('/'), 'CHATGPT_EXTENSION_MODEL không được chứa "/"');
  assert.ok(!CHATGPT_LOCAL_MODEL.includes('/'), 'CHATGPT_LOCAL_MODEL không được chứa "/"');
  assert.notEqual(CHATGPT_EXTENSION_MODEL, CHATGPT_LOCAL_MODEL, 'hai provider trùng value');
}

// ── flowJobs.ts phải rẽ đúng: extension → source 'extension', local → 'playwright' ─────────
{
  const src = fs.readFileSync('lib/googleFlow/flowJobs.ts', 'utf8');
  const idxChatgpt = src.indexOf('CHATGPT_EXTENSION_MODEL');
  const idxSlash = src.indexOf("model?.includes('/')");
  assert.ok(idxChatgpt > 0, 'flowJobs.ts chưa xử lý CHATGPT_EXTENSION_MODEL');
  assert.ok(idxSlash > 0, 'flowJobs.ts không còn nhánh OmniRoute?');
  assert.ok(
    idxChatgpt < idxSlash,
    'nhánh chatgpt-extension phải đứng TRƯỚC nhánh "/" — đứng sau là không bao giờ chạy tới'
  );
  assert.ok(
    /source:\s*model === CHATGPT_EXTENSION_MODEL \? 'extension' : 'playwright'/.test(src),
    'flowJobs.ts chưa truyền đúng source theo model'
  );
}

// ── Route worker chỉ được claim job source='extension' ────────────────────────────────────
{
  const src = fs.readFileSync('app/api/chatgpt-image/worker/route.ts', 'utf8');
  assert.ok(
    /claimNextJob\('extension',\s*'extension'\)/.test(src),
    'route worker phải claim đúng source extension, không được lấy job của Playwright'
  );
  // markExtensionPolled phải chạy TRƯỚC khi biết có job hay không — nó là nhịp tim, đặt sau
  // nhánh "không có job" thì lúc rảnh việc server tưởng extension đã chết.
  // Cắt phần import ra trước khi so vị trí: `claimNextJob` xuất hiện ở dòng import sớm hơn mọi
  // lời gọi thật, so nguyên file sẽ luôn fail dù code đúng.
  const body = src.slice(src.indexOf('export async function GET'));
  const idxMark = body.indexOf('markExtensionPolled()');
  const idxClaim = body.indexOf('claimNextJob(');
  assert.ok(idxMark >= 0, 'GET không gọi markExtensionPolled');
  assert.ok(idxClaim >= 0, 'GET không gọi claimNextJob');
  assert.ok(idxMark < idxClaim, 'markExtensionPolled phải gọi trước claimNextJob');

  // Reap phải chạy trong route này. worker.ts chỉ reap 1 lần lúc server khởi động, mà job
  // extension không có vòng lặp server-side nào ngó tới — thiếu reap ở đây thì đóng Chrome
  // giữa chừng là job kẹt 'running' tới lần restart kế tiếp.
  assert.ok(/reapStaleJobs\(/.test(body), 'route worker phải dọn job chết, không thì job kẹt vĩnh viễn');
  assert.ok(body.indexOf('reapStaleJobs(') < idxClaim, 'reap phải chạy trước claim');

  // Nhận kết quả muộn cho job đã kết thúc thì phải bỏ qua, không ghi đè trạng thái đã chốt.
  assert.ok(
    /job\.status !== 'running'/.test(src),
    'POST phải bỏ qua kết quả của job không còn ở trạng thái running'
  );
}

// ── Worker Playwright vẫn phải mặc định 'playwright' ──────────────────────────────────────
{
  const src = fs.readFileSync('lib/chatgptImage/jobStore.ts', 'utf8');
  assert.ok(
    /source:\s*ChatgptImageJobSource = 'playwright'/.test(src),
    'claimNextJob phải mặc định source playwright để worker cũ không đổi hành vi'
  );
  assert.ok(
    /eq\(chatgptImageJobs\.source, source\)/.test(src),
    'claimNextJob chưa lọc theo source — hai worker sẽ cướp job của nhau'
  );
  assert.ok(
    /source: input\.source \|\| 'playwright'/.test(src),
    'createJob phải mặc định playwright cho job cũ'
  );
}

// ── Ngưỡng online: bài học từ recaptcha.ts, KHÔNG được đặt ngắn ────────────────────────────
{
  // Chrome throttle setInterval tab nền xuống >=60s, SW MV3 bị kill sau ~30s idle. Ngưỡng phải
  // đủ dài để lỡ 2 nhịp alarm keepalive (1 phút) mà không báo offline oan.
  assert.ok(
    EXTENSION_STALE_MS >= 120_000,
    `ngưỡng ${EXTENSION_STALE_MS}ms quá ngắn — tab nền bị throttle sẽ báo offline oan`
  );
}

// ── isExtensionOnline đúng ở cả 3 mốc ─────────────────────────────────────────────────────
{
  // Chưa poll lần nào (server vừa khởi động) → offline. Không "cho qua": nói offline thì người
  // dùng mở Chrome là xong, còn nói online rồi treo 11 phút mới lộ là tệ hơn.
  __testables.setLastPollAt(0);
  assert.equal(isExtensionOnline(), false, 'chưa poll lần nào mà báo online');
  assert.equal(lastExtensionPollAt(), 0, 'lastExtensionPollAt phải là 0 khi chưa poll');

  // Vừa poll → online.
  markExtensionPolled();
  assert.equal(isExtensionOnline(), true, 'vừa poll mà báo offline');
  assert.ok(lastExtensionPollAt() > 0, 'markExtensionPolled không ghi mốc');

  // Tab nền bị throttle 60s → VẪN phải online (đây là ca hay báo oan nhất).
  const now = Date.now();
  __testables.setLastPollAt(now - 60_000);
  assert.equal(isExtensionOnline(now), true, 'throttle 60s mà đã báo offline');

  // Lỡ 2 nhịp alarm (120s) → vẫn sống.
  __testables.setLastPollAt(now - 120_000);
  assert.equal(isExtensionOnline(now), true, 'lỡ 2 nhịp alarm mà đã báo offline');

  // Quá ngưỡng → offline.
  __testables.setLastPollAt(now - EXTENSION_STALE_MS - 1);
  assert.equal(isExtensionOnline(now), false, 'quá ngưỡng mà vẫn báo online');
}

// ── Extension: selector phải khớp domScript.ts ────────────────────────────────────────────
{
  const dom = fs.readFileSync('lib/chatgptImage/domScript.ts', 'utf8');
  const ext = fs.readFileSync('extension-chatgpt/imageJob.js', 'utf8');

  // Composer selector là thứ quyết định "trang đã sẵn sàng chưa" ở CẢ hai đường. Lệch nhau thì
  // một bên chạy được còn bên kia đứng im, mà triệu chứng giống hệt "ChatGPT đổi giao diện".
  const composer = dom.match(/COMPOSER_SELECTOR = '([^']+)'/)?.[1];
  assert.ok(composer, 'không đọc được COMPOSER_SELECTOR từ domScript.ts');
  assert.ok(
    ext.includes(composer!),
    `extension dùng composer selector khác domScript.ts (${composer})`
  );

  // Mốc DOM dùng để nhận diện ảnh kết quả — định nghĩa ở domScript.ts, extension phải theo.
  for (const token of ['data-message-author-role', 'oaiusercontent', 'backend-api']) {
    assert.ok(dom.includes(token), `domScript.ts thiếu "${token}"?`);
    assert.ok(ext.includes(token), `extension thiếu "${token}" — sẽ không nhận ra ảnh kết quả`);
  }

  // Selector thao tác nằm ở runner.ts (domScript.ts chỉ giữ phần đọc trạng thái).
  const runner = fs.readFileSync('lib/chatgptImage/runner.ts', 'utf8');
  for (const token of ['send-button', 'stop-button', 'input[type="file"]']) {
    assert.ok(runner.includes(token), `runner.ts thiếu "${token}"?`);
    assert.ok(ext.includes(token), `extension thiếu "${token}" — lệch với bản Playwright`);
  }

  // Ngưỡng lọc ảnh phải giống nhau, nếu không một bên nhận avatar làm kết quả.
  assert.ok(dom.includes('256'), 'domScript.ts đổi ngưỡng kích thước ảnh?');
  assert.ok(ext.includes('256'), 'extension lệch ngưỡng kích thước ảnh so với domScript.ts');
}

// ── Extension: manifest phải đủ quyền cho việc mới ────────────────────────────────────────
{
  const mf = JSON.parse(fs.readFileSync('extension-chatgpt/manifest.json', 'utf8'));
  for (const perm of ['tabs', 'scripting', 'storage', 'alarms', 'cookies']) {
    assert.ok(mf.permissions.includes(perm), `manifest thiếu quyền "${perm}"`);
  }
  assert.ok(
    (mf.content_scripts || []).some((c: { js: string[] }) => c.js.includes('content.js')),
    'manifest chưa khai báo content.js — SW sẽ không được đánh thức đều đặn'
  );
  // background.js importScripts('imageJob.js') chỉ chạy được với classic script.
  assert.notEqual(mf.background.type, 'module', 'SW là module thì importScripts sẽ lỗi');

  const bg = fs.readFileSync('extension-chatgpt/background.js', 'utf8');
  assert.ok(bg.includes("importScripts('imageJob.js')"), 'background.js chưa nạp imageJob.js');
  assert.ok(bg.includes('runImageJobInPage'), 'background.js không gọi runImageJobInPage');
}

// ── Service worker KHÔNG được ngồi chờ job xong ───────────────────────────────────────────
{
  // Đây là lỗi đã thực sự xảy ra (job cgimg-66caf914d5f1 kẹt 'running'): SW `await executeScript`
  // suốt lúc gen ảnh → không gọi API nào → Chrome kill SW sau 30s idle (và cắt cứng mọi request
  // quá 5 phút). Ảnh lấy được nhưng không còn ai nhận.
  const bg = fs.readFileSync('extension-chatgpt/background.js', 'utf8');
  const job = fs.readFileSync('extension-chatgpt/imageJob.js', 'utf8');

  // Trang phải trả về NGAY, không await xong việc (SW bị kill nếu ngồi chờ).
  assert.ok(
    /return \{ started: true \}/.test(job),
    'runImageJobInPage phải trả về ngay sau khi khởi động, không chờ gen xong'
  );

  // Trang TUYỆT ĐỐI KHÔNG được fetch về app: CSP của chatgpt.com chỉ cho connect-src tới domain
  // của họ, mọi request tới localhost/video.homebox.vn bị chặn thẳng ("Refused to connect because
  // it violates the document's Content Security Policy"). Đã gặp thật: ảnh lấy được rồi nhưng
  // không nộp về được. Chỉ service worker fetch được.
  assert.ok(
    !/fetch\(\s*workerUrl/.test(job),
    'imageJob.js không được fetch thẳng về app — CSP của chatgpt.com sẽ chặn'
  );
  assert.ok(
    /window\.postMessage/.test(job),
    'imageJob.js phải gửi kết quả qua window.postMessage cho content script'
  );

  // Content script làm cầu nối: bắt postMessage rồi chuyển cho SW.
  const content = fs.readFileSync('extension-chatgpt/content.js', 'utf8');
  assert.ok(
    /__chatgptImageResult/.test(content),
    'content.js phải bắt message kết quả từ MAIN world'
  );
  assert.ok(
    /type: 'JOB_RESULT'/.test(content),
    'content.js phải chuyển kết quả cho service worker'
  );

  // SW nhận JOB_RESULT rồi mới POST về app.
  assert.ok(/'JOB_RESULT'/.test(bg), 'SW chưa xử lý JOB_RESULT');
  assert.ok(/async function handleJobResult/.test(bg), 'SW thiếu handleJobResult');
  // Ảnh dạng URL thì SW tự tải, tránh nhồi vài MB base64 qua 2 chặng message.
  assert.ok(/payload\.imageUrl/.test(bg), 'SW phải tự tải ảnh khi trang chỉ đưa URL');
  // Cờ chặn claim chồng khi tab còn đang gen.
  assert.ok(/inFlightUntil/.test(bg), 'thiếu cờ chặn claim job mới khi tab còn đang gen');
  assert.ok(/probe=/.test(bg), 'SW phải hỏi server để nhả cờ sớm khi job xong');

  // Tự nạp lại content script: reload extension làm instance cũ orphan và chết vĩnh viễn.
  // Thiếu cái này thì sau mỗi lần sửa code, tab đang mở im lặng không tick nữa — job nằm chờ
  // mà nhìn từ ngoài giống hệt "extension hỏng". extension-flow đã trả giá đúng bài này.
  assert.ok(
    /async function reinjectContentScript/.test(bg),
    'thiếu reinjectContentScript — content script orphan sẽ không bao giờ sống lại'
  );
  assert.ok(
    /files: \['content\.js'\]/.test(bg),
    'reinjectContentScript phải inject file content.js'
  );
  // Phải chạy cả lúc SW load (ngay sau reload) lẫn theo nhịp alarm.
  const afterAlarm = bg.slice(bg.indexOf('KEEPALIVE_ALARM'));
  assert.ok(
    /reinjectContentScript\(\)/.test(afterAlarm),
    'reinjectContentScript phải được gọi ở nhịp alarm keepalive'
  );

  // runJob phải nằm TRONG runImageJobInPage: executeScript chỉ serialize đúng một hàm, hàm
  // top-level khác sẽ không tồn tại trong trang.
  const start = job.indexOf('function runImageJobInPage');
  assert.ok(start >= 0, 'không tìm thấy runImageJobInPage');
  const after = job.slice(start);
  const endOfFn = after.indexOf('\n}\n');
  assert.ok(endOfFn > 0, 'không xác định được điểm kết thúc runImageJobInPage');
  const fnBody = after.slice(0, endOfFn);
  assert.ok(
    fnBody.includes('async function runJob'),
    'runJob phải nằm TRONG runImageJobInPage, nếu không trang sẽ không thấy nó'
  );
  // Có job mà không tìm thấy tab thì PHẢI báo fail, không được im lặng bỏ qua.
  assert.ok(
    /Không tìm thấy tab chatgpt\.com/.test(bg),
    'thiếu nhánh báo lỗi khi không có tab — job sẽ treo tới lúc reap'
  );
}

// ── Bộ lọc ảnh của extension: đúng ở cả ca ảnh nằm ngoài lượt hội thoại ───────────────────
{
  const src = fs.readFileSync('extension-chatgpt/imageJob.js', 'utf8');
  const m = src.match(/ {4}function isResultImage\(img\) \{[\s\S]*?\n {4}\}/);
  assert.ok(m, 'không tách được isResultImage khỏi imageJob.js');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const isResult = new Function(`return (${m![0].trim()})`)() as (img: Record<string, unknown>) => boolean;

  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    [
      'ảnh kết quả chuẩn',
      { src: 'https://x/backend-api/files/a.png', naturalWidth: 1024, naturalHeight: 1024, turnKnown: true, inAssistantTurn: true, afterCurrentUserTurn: true },
      true,
    ],
    // Ca vừa nới: ChatGPT có thể bọc ảnh ngoài [data-message-author-role]. Chặt quá thì job
    // treo hết timeout mà không rõ vì sao — đã gặp thật với job cgimg-a104c9d3c7b2.
    ['ảnh nằm ngoài lượt hội thoại', { src: 'blob:https://chatgpt.com/abc', naturalWidth: 1024, naturalHeight: 1024, turnKnown: false }, true],
    // Nhưng ảnh REF do user vừa upload thì vẫn phải loại — nhận nhầm là gen ra chính ảnh đầu vào.
    [
      'ảnh ref của user',
      { src: 'https://x/backend-api/files/ref.png', naturalWidth: 1024, naturalHeight: 1024, turnKnown: true, inAssistantTurn: false, afterCurrentUserTurn: true },
      false,
    ],
    [
      'ảnh cũ trước lượt user hiện tại',
      { src: 'https://x/backend-api/files/old.png', naturalWidth: 1024, naturalHeight: 1024, turnKnown: true, inAssistantTurn: true, afterCurrentUserTurn: false },
      false,
    ],
    ['avatar nhỏ', { src: 'https://x/avatar/u.png', naturalWidth: 64, naturalHeight: 64, turnKnown: false }, false],
    ['url không phải ảnh kết quả', { src: 'https://cdn.example.com/banner.jpg', naturalWidth: 1024, naturalHeight: 1024, turnKnown: false }, false],
    ['ảnh chưa load xong', { src: 'blob:https://chatgpt.com/x', naturalWidth: 0, naturalHeight: 0, turnKnown: false }, false],
  ];

  for (const [name, img, expected] of cases) {
    assert.equal(isResult(img), expected, `isResultImage sai ở ca "${name}"`);
  }

  // Vòng poll phải log định kỳ — không có log thì lúc kẹt chỉ im lặng 10 phút rồi timeout,
  // không đủ dữ kiện để sửa (đúng tình huống đã gặp).
  assert.ok(/pollCount % 5 === 0/.test(src), 'vòng poll thiếu log định kỳ để chẩn đoán');

  // Phải dùng img.src (URL đã phân giải), không phải getAttribute('src') — với blob: hai giá
  // trị này khác nhau và bộ lọc kiểm theo URL đầy đủ.
  assert.ok(
    /const src = img\.src \|\| img\.getAttribute\('src'\)/.test(src),
    'phải ưu tiên img.src (URL đã phân giải) khi lọc ảnh'
  );
}

// ── Các mốc timeout phải xếp đúng thứ tự ─────────────────────────────────────────────────
{
  // Lệch thứ tự là hỏng theo kiểu khó đoán: server bỏ cuộc trong khi tab vẫn đang vẽ, hoặc reap
  // giết nhầm job đang chạy hợp lệ. Cả hai đều hiện ra dưới dạng "hết thời gian chờ" / "job bị
  // bỏ dở" mà nhìn log không biết vì sao — đã gặp thật.
  const num = (src: string, re: RegExp, name: string): number => {
    const m = src.match(re);
    assert.ok(m, `không đọc được ${name}`);
    // Hỗ trợ cả "20 * 60 * 1000" lẫn "21 * 60_000".
    return eval(m![1].replace(/_/g, '')) as number;
  };

  const jobSrc = fs.readFileSync('extension-chatgpt/imageJob.js', 'utf8');
  const bgSrc = fs.readFileSync('extension-chatgpt/background.js', 'utf8');
  const routeSrc = fs.readFileSync('app/api/chatgpt-image/worker/route.ts', 'utf8');
  const genSrc = fs.readFileSync('lib/chatgptImage/imageGen.ts', 'utf8');

  const hardPage = num(jobSrc, /HARD_TIMEOUT_MS = ([\d *_]+);/, 'HARD_TIMEOUT_MS');
  const inFlight = num(bgSrc, /IN_FLIGHT_MS = ([\d *_]+);/, 'IN_FLIGHT_MS');
  const reap = num(routeSrc, /STALE_RUNNING_MS = ([\d *_]+);/, 'STALE_RUNNING_MS');
  const server = num(genSrc, /source === 'extension' \? ([\d *_]+) :/, 'timeout server');

  assert.ok(server >= hardPage, `server (${server}) phải chờ >= trần trang (${hardPage})`);
  assert.ok(inFlight >= hardPage, `cờ SW (${inFlight}) phải >= trần trang (${hardPage})`);
  assert.ok(reap > hardPage, `reap (${reap}) phải > trần trang (${hardPage}), không thì giết nhầm job đang chạy`);
  assert.ok(reap > server, `reap (${reap}) phải > timeout server (${server})`);
}

console.log('✅ check-chatgpt-extension: OK');
