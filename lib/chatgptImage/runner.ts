/**
 * Điều phối Playwright để gen 1 ảnh qua chatgpt.com. KHÔNG chứa selector — mọi thứ liên
 * quan DOM nằm ở domScript.ts.
 *
 * Kiến trúc (đã chốt hướng A): dùng persistent context trỏ vào profile Chromium riêng của
 * từng account (data/chatgpt-profiles/<id>/). Profile được tạo bằng cách login THỦ CÔNG một
 * lần qua `npm run chatgpt:login` trên máy có màn hình, rồi copy lên VPS.
 *
 * Vì sao headful qua Xvfb chứ không headless: ChatGPT phát hiện headless khá tốt. Trên VPS,
 * PM2 phải chạy dưới `xvfb-run` (xem docs/DEPLOY.md) để có DISPLAY ảo.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium, type BrowserContext } from 'playwright';
import { profileDir, markNeedsLogin, markOk } from './accountStore';
import {
  COMPOSER_SELECTOR,
  readPageState,
  captureBaseline,
  isResultImage,
  buildPrompt,
} from './domScript';

const TMP_DIR = path.join(process.cwd(), 'data', 'tmp', 'chatgpt-image');

/**
 * Fingerprint phải GIỐNG HỆT giữa máy login và VPS chạy. Profile Chromium mang theo dấu vết
 * phiên; mở lại với UA/viewport/locale khác là tín hiệu bất thường rõ rệt cho hệ chống bot,
 * dễ bị đá ra đòi verify lại. Khoá cứng ở một chỗ để cả 2 pha dùng chung.
 */
export const BROWSER_FINGERPRINT = {
  viewport: { width: 1440, height: 900 },
  locale: 'vi-VN',
  timezoneId: 'Asia/Ho_Chi_Minh',
} as const;

/** Lỗi phiên chết — phân biệt với lỗi tạm thời để tầng trên KHÔNG retry (doc mục 6). */
export class ChatgptLoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatgptLoginRequiredError';
  }
}

export interface RunImageParams {
  accountId: string;
  prompt: string;
  aspect: '9:16' | '16:9';
  refImagePaths?: string[];
  /** Tổng thời gian chờ 1 lượt gen. Doc dùng ~10 phút. */
  timeoutMs?: number;
  /** Hiện cửa sổ browser để soi automation đang làm gì. */
  debug?: boolean;
}

export async function openContext(accountId: string, debug = false): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profileDir(accountId), {
    // headless:false + Xvfb trên VPS. Xem ghi chú đầu file.
    headless: false,
    args: debug ? [] : ['--window-position=-2400,-2400'],
    ...BROWSER_FINGERPRINT,
  });
}

/**
 * Gen 1 ảnh. Trả đường dẫn file local đã ghi.
 *
 * Ném ChatgptLoginRequiredError nếu phiên chết (tầng trên dừng hẳn, không retry).
 */
export async function generateOneImage(params: RunImageParams): Promise<string> {
  const timeoutMs = params.timeoutMs ?? 10 * 60_000;
  const deadline = Date.now() + timeoutMs;
  const context = await openContext(params.accountId, params.debug);

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // 1. Chờ trang sẵn sàng, phân biệt "chưa load xong" với "phiên đã chết".
    await waitReady(page, params.accountId, deadline);

    // 2. Đính kèm ảnh tham chiếu (nếu có) — dùng API file chooser của Playwright thay vì
    // 4 chiến lược DataTransfer/paste/drag của doc: Playwright điều khiển browser thật từ
    // ngoài trang nên set được input file trực tiếp, không cần giả lập event trong JS.
    const refs = params.refImagePaths || [];
    if (refs.length > 0) await attachRefImages(page, refs);

    // 3. Gõ prompt. contenteditable nên fill() của Playwright xử lý được, không cần
    // chuỗi fallback execCommand/paste như doc (doc bị kẹt vì chỉ tiêm được JS thuần).
    const composer = page.locator(COMPOSER_SELECTOR).first();
    await composer.click();
    await composer.fill(buildPrompt({ prompt: params.prompt, aspect: params.aspect, hasRefImages: refs.length > 0 }));

    // 4. Baseline TRƯỚC khi gửi — mốc phân biệt ảnh mới với ảnh cũ đang có sẵn trên trang.
    const baseline = await page.evaluate(captureBaseline);

    // 5. Gửi.
    const sendButton = page.locator('[data-testid="send-button"]');
    if (await sendButton.count()) await sendButton.first().click();
    else await composer.press('Enter');

    // 6. Poll tới khi có ảnh ổn định.
    const src = await pollForImage(page, baseline, deadline);

    // 7. Lấy bytes thật rồi ghi ra đĩa.
    const filePath = await saveImage(page, src);
    markOk(params.accountId);
    return filePath;
  } finally {
    await context.close().catch(() => {});
  }
}

type Page = Awaited<ReturnType<BrowserContext['newPage']>>;

async function waitReady(page: Page, accountId: string, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const state = await page.evaluate(readPageState, COMPOSER_SELECTOR);
    if (state === 'ready') return;
    if (state === 'login') {
      const msg = 'Phiên ChatGPT đã hết hạn — cần đăng nhập lại (npm run chatgpt:login)';
      markNeedsLogin(accountId, msg);
      throw new ChatgptLoginRequiredError(msg);
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Hết thời gian chờ trang ChatGPT sẵn sàng');
}

async function attachRefImages(page: Page, refPaths: string[]): Promise<void> {
  // Input file của ChatGPT bị ẩn bằng CSS nhưng vẫn nằm trong DOM — setInputFiles không đòi
  // phần tử phải nhìn thấy được, nên set thẳng là xong.
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: 'attached', timeout: 15_000 });
  await input.setInputFiles(refPaths);

  // Verify thật sự đính kèm xong (doc mục 4): dispatch xong KHÔNG có nghĩa là đã upload.
  // Gửi prompt khi ảnh ref chưa lên thì ChatGPT vẫn trả lời — nhưng vẽ sai đề, và không có
  // lỗi nào cho biết vì sao.
  await page
    .locator('[data-testid*="attachment"], [class*="attachment"], [class*="thumbnail"]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .catch(() => {
      throw new Error('Không upload được ảnh tham chiếu lên ChatGPT');
    });
}

/**
 * Poll tới khi tìm được ảnh kết quả ỔN ĐỊNH.
 *
 * "Ổn định" = cùng một src xuất hiện ở 2 vòng poll liên tiếp. Lúc đang vẽ, ChatGPT hiển thị
 * ảnh preview độ phân giải thấp và đổi src liên tục — chốt ngay ảnh đầu tiên nhìn thấy sẽ
 * lấy phải bản nháp mờ.
 */
async function pollForImage(
  page: Page,
  baseline: { images: string[]; turnCount: number },
  deadline: number
): Promise<string> {
  let lastSeen: string | null = null;
  const seenSrcs = new Set<string>();

  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);

    const candidates = await page.evaluate(
      ({ base, fnBody }) => {
        // eslint-disable-next-line no-new-func
        const isResult = new Function(`return (${fnBody})`)() as (img: {
          src: string;
          naturalWidth: number;
          naturalHeight: number;
          inAssistantTurn: boolean;
          afterCurrentUserTurn: boolean;
        }) => boolean;

        const known = new Set(base.images);
        const turns = Array.from(document.querySelectorAll('[data-message-author-role]'));
        // Lượt user mới nhất = mốc; ảnh phải nằm SAU nó mới thuộc về prompt vừa gửi.
        const userTurns = turns.filter((t) => t.getAttribute('data-message-author-role') === 'user');
        const currentUserTurn = userTurns[userTurns.length - 1] || null;
        const currentIdx = currentUserTurn ? turns.indexOf(currentUserTurn) : -1;

        const out: string[] = [];
        for (const img of Array.from(document.querySelectorAll('img'))) {
          const src = img.getAttribute('src') || '';
          const sig = `${src}|${img.getAttribute('alt') || ''}`;
          if (known.has(sig)) continue;

          const turn = img.closest('[data-message-author-role]');
          const inAssistantTurn = turn?.getAttribute('data-message-author-role') === 'assistant';
          const afterCurrentUserTurn = turn ? turns.indexOf(turn) > currentIdx : false;

          if (
            isResult({
              src,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              inAssistantTurn,
              afterCurrentUserTurn,
            })
          ) {
            out.push(src);
          }
        }
        return out;
      },
      { base: baseline, fnBody: isResultImage.toString() }
    );

    for (const src of candidates) seenSrcs.add(src);
    const found = candidates[0];

    if (found) {
      // Ổn định = thấy đúng src này 2 vòng liên tiếp.
      if (found === lastSeen) return found;
      lastSeen = found;
      continue;
    }
    lastSeen = null;

    // Không có ảnh nhưng ChatGPT đã trả lời bằng TEXT (từ chối vẽ / hỏi lại) → báo lỗi kèm
    // nội dung luôn, thay vì poll tới hết 10 phút rồi chỉ nói "timeout" (doc mục 10).
    const refusal = await page.evaluate(() => {
      const turns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const last = turns[turns.length - 1];
      if (!last) return null;
      // Còn đang stream thì chưa kết luận được.
      if (document.querySelector('[data-testid="stop-button"]')) return null;
      if (last.querySelector('img')) return null;
      const text = (last as HTMLElement).innerText?.trim() || '';
      return text.length > 0 ? text.slice(0, 300) : null;
    });
    if (refusal) throw new Error(`ChatGPT trả lời bằng text thay vì ảnh: ${refusal}`);
  }

  if (seenSrcs.size > 0) {
    throw new Error(
      `Hết thời gian chờ: thấy ảnh nhưng không ổn định được. src đã thấy: ${Array.from(seenSrcs).slice(0, 3).join(', ')}`
    );
  }
  throw new Error('Hết thời gian chờ ChatGPT trả ảnh');
}

/**
 * Lấy bytes ảnh. Fetch trong trang (kèm cookie phiên) rồi trả base64 — ảnh ChatGPT nằm sau
 * xác thực nên fetch từ Node sẽ 403. Fallback vẽ ra canvas khi CORS chặn fetch nhưng ảnh
 * vẫn render được (doc mục 10).
 */
async function saveImage(page: Page, src: string): Promise<string> {
  const b64 = await page.evaluate(async (imgSrc) => {
    const toB64 = (buf: ArrayBuffer) => {
      let binary = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    };
    try {
      const res = await fetch(imgSrc, { credentials: 'include' });
      if (res.ok) return toB64(await res.arrayBuffer());
    } catch {
      /* rơi xuống canvas */
    }
    const img = Array.from(document.querySelectorAll('img')).find(
      (el) => el.getAttribute('src') === imgSrc
    ) as HTMLImageElement | undefined;
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1] || null;
  }, src);

  if (!b64) throw new Error('Không lấy được dữ liệu ảnh từ trang ChatGPT');

  await fs.mkdir(TMP_DIR, { recursive: true });
  const dest = path.join(TMP_DIR, `img-${crypto.randomBytes(6).toString('hex')}.png`);
  await fs.writeFile(dest, Buffer.from(b64, 'base64'));
  return dest;
}
