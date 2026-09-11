/**
 * Self-check: nhãn `source_kind` (loại dây chuyền) được gắn ĐÚNG và ĐỦ cho mọi lượt log AI.
 *
 * Vì sao cần — cột này là thứ tab /logs dùng để lọc, mà mọi cách hỏng của nó đều IM LẶNG:
 *
 * 1. Quên gắn ở một call-site → lượt đó ghi '' và biến mất khỏi mọi bộ lọc theo loại. Không lỗi,
 *    không cảnh báo; Mr.D chỉ thấy "hình như thiếu vài dòng".
 * 2. Gắn SAI ở bước ingest → job V2 bị dán nhãn V1. Tệ hơn quên: log trông như thật nên mọi kết
 *    luận rút ra từ nó đều sai. Đây là bẫy có thật, không phải giả định: row livestream_v2_inputs
 *    chỉ được ghi SAU khi ingest xong (xem app/api/livestream/route.ts), nên tra DB lúc ingest
 *    luôn trả 'livestream-v1'.
 * 3. resolveLivestreamKind ném → làm fail cả lượt gen chỉ vì không tra được một cái nhãn phụ trợ.
 *
 * Kiểm bằng quét mã nguồn vì đây là chuyện "ai truyền gì cho ai" — dựng lại bằng hàm thuần thì
 * phải mô phỏng cả 4 tầng gọi, mà chạy thật thì cần DB (check phải chạy được ở CI không có DB).
 *
 * Chạy: npm run check:log-source-kind
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_KINDS, SOURCE_KIND_LABEL, isSourceKind } from '../lib/logs/sourceKind';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
/** Bỏ dòng comment: nhiều doc-comment NHẮC tên hàm để cảnh báo "đừng dùng ở đây". */
const codeOnly = (src: string) =>
  src
    .split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n');

// --- 1. Tập giá trị khai báo MỘT chỗ, và khớp với nhãn UI ---
assert.deepEqual(
  [...SOURCE_KINDS],
  ['livestream-v1', 'livestream-v2', 'product-review'],
  'đổi tập giá trị phải sửa cả migration + UI, không đổi lặng lẽ ở đây'
);
for (const k of SOURCE_KINDS) {
  assert.ok(SOURCE_KIND_LABEL[k], `thiếu nhãn tiếng Việt cho "${k}" — UI sẽ hiện key thô`);
}
// '' KHÔNG hợp lệ như một giá trị ghi mới, nhưng PHẢI có nhãn: log cũ (trước migration 0025) mang
// giá trị này và vẫn phải đọc được.
assert.equal(isSourceKind(''), false, "'' không được coi là giá trị hợp lệ khi lọc");
assert.ok(SOURCE_KIND_LABEL[''], "phải có nhãn cho '' — log cũ trước migration mang giá trị này");
assert.equal(isSourceKind('livestream-v3'), false, 'giá trị lạ từ query string phải bị loại');

// --- 2. Mắt xích ghi: context → recordAiCall → cột DB ---
const callLog = read('lib/ai/callLog.ts');
assert.match(callLog, /sourceKind\?: string;/, 'AiCallContext phải có sourceKind');
assert.match(callLog, /sourceKind: string;/, 'recordAiCall phải nhận sourceKind');
assert.match(
  read('lib/ai/chatClient.ts'),
  /sourceKind: ctx\.sourceKind \?\? ''/,
  'chatClient phải truyền sourceKind xuống recordAiCall — thiếu là cột luôn rỗng'
);
assert.match(
  read('lib/db/schema/aiCallLogs.ts'),
  /sourceKind: varchar\('source_kind'/,
  'schema phải khai cột source_kind'
);

// --- 3. Mọi call-site gắn log đều phải gắn nhãn ---
// Liệt kê ĐÍCH DANH thay vì quét thư mục: thêm bước AI mới mà quên nhãn thì phải sửa file này,
// và lúc đó mới có người đọc lại danh sách để thấy mình còn thiếu chỗ nào.
const SITES: Array<[string, string]> = [
  ['lib/data/storyboardPromptGenerate.ts', 'product-review'],
  ['lib/data/productVisionExtract.ts', 'product-review'],
  ['lib/data/veoPromptEvaluate.ts', 'product-review'],
  ['app/api/projects/[id]/script/generate/route.ts', 'product-review'],
  ['lib/livestream/productExtract.ts', ''],
  ['lib/livestream/productVision.ts', ''],
  ['lib/livestream/productLock.ts', ''],
  ['lib/livestream/stageBible.ts', ''],
  ['lib/livestream/v2FieldExtract.ts', 'livestream-v2'],
  ['app/api/livestream/[id]/script/generate/route.ts', ''],
  ['app/api/livestream/[id]/steps/[step]/route.ts', ''],
];
for (const [file, expectConst] of SITES) {
  const src = codeOnly(read(file));
  assert.match(src, /sourceKind/, `${file}: call-site gắn log nhưng KHÔNG gắn sourceKind`);
  if (expectConst) {
    assert.ok(
      src.includes(`'${expectConst}'`),
      `${file}: phải gắn HẰNG '${expectConst}' (luồng này chỉ có một loại)`
    );
  }
}

// --- 4. Bẫy ingest: nhãn phải đi TỪ ROUTE xuống, không tra DB ---
const createRoute = read('app/api/livestream/route.ts');
assert.match(
  createRoute,
  /const sourceKind = v2Raw \? 'livestream-v2' : 'livestream-v1'/,
  'route tạo job phải suy nhãn từ form v2Input'
);
// Thứ tự quan trọng: phải suy nhãn TRƯỚC khi gọi ingestEntry, không thì vẫn truyền undefined.
assert.ok(
  createRoute.indexOf('const sourceKind =') < createRoute.indexOf('ingestEntry('),
  'phải suy sourceKind TRƯỚC khi gọi ingestEntry'
);
assert.ok(
  !/resolveLivestreamKind\(/.test(codeOnly(read('lib/livestream/ingestEntry.ts'))),
  'ingestEntry KHÔNG được tra DB: row livestream_v2_inputs chưa tồn tại lúc ingest'
);

// --- 5. resolveLivestreamKind: không ném, và cache không kẹt nhãn cũ ---
const v2Store = read('lib/livestream/v2Store.ts');
const fn = v2Store.slice(v2Store.indexOf('export async function resolveLivestreamKind'));
const body = fn.slice(0, fn.indexOf('\n}\n'));
assert.match(body, /catch/, 'resolveLivestreamKind PHẢI nuốt lỗi — log hỏng không được giết lượt gen');
assert.ok(
  !/throw/.test(body),
  'resolveLivestreamKind không được ném: nó chạy trong đường gen video/script thật'
);
// Ca thật: tạo job (chưa có row V2) → ai đó gọi resolve → cache 'v1' → writeV2Input → nếu không
// cập nhật cache thì MỌI log sau đó của job V2 mang nhãn V1.
assert.match(
  v2Store,
  /kindCache\.set\(jobSlug, 'livestream-v2'\)/,
  'writeV2Input phải cập nhật cache, nếu không job vừa đánh dấu V2 vẫn mang nhãn V1'
);

console.log(
  `✅ check-log-source-kind: OK (${SOURCE_KINDS.length} giá trị, ${SITES.length} call-site đều gắn nhãn, ` +
    `ingest nhận nhãn từ route, resolveLivestreamKind không ném)`
);
