import { chromium } from 'playwright';
import { BROWSER_FETCH_TIMEOUT_MS, MIN_FETCHED_TEXT_LENGTH } from './constants';

const MAX_FETCHED_TEXT_LENGTH = 8000;

/**
 * Tier 2 fetch link — dùng headless browser (Playwright) khi fetch thô (tier 1, xem
 * productFetch.ts) thất bại, thường do trang render nội dung bằng JS phía client (SPA)
 * mà fetch thô không đọc được. Nặng hơn tier 1 nhiều (mở browser thật) nên chỉ nên gọi
 * sau khi tier 1 đã thất bại, không phải đường mặc định.
 *
 * LƯU Ý: không giúp ích với các nền tảng chủ động chặn bot ở tầng fingerprint/CAPTCHA
 * (VD Shopee — đã kiểm chứng vẫn bị chặn kể cả qua headless browser thật) — với các
 * domain đó, productFetch.ts chặn sớm không gọi tới hàm này (xem KNOWN_BLOCKED_DOMAINS).
 */
export async function fetchProductFromLinkViaBrowser(url: string): Promise<string | null> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: BROWSER_FETCH_TIMEOUT_MS });
    const text = await page.evaluate(() => document.body.innerText || '');
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length < MIN_FETCHED_TEXT_LENGTH) return null;
    return trimmed.slice(0, MAX_FETCHED_TEXT_LENGTH);
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
