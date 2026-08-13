import { LINK_FETCH_TIMEOUT_MS, MIN_FETCHED_TEXT_LENGTH } from './constants';

const MAX_FETCHED_TEXT_LENGTH = 8000;

// Domain đã XÁC NHẬN qua test thật là chặn cả headless browser (không chỉ fetch thô) —
// short-circuit để không tốn ~15s thử tier 2 vô ích. CHỈ thêm domain đã kiểm chứng thật,
// không suy đoán — các sàn khác chưa test vẫn được thử đầy đủ cả 2 tier.
const KNOWN_BLOCKED_DOMAINS = [/(^|\.)shopee\./i];

function isKnownBlockedDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return KNOWN_BLOCKED_DOMAINS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tier 1 — fetch HTML thô (server-side, không dùng trình duyệt thật, rất nhanh). Thành công
 * với các nguồn server-rendered (landing page, bài viết, web bán hàng đơn giản...). Trả về
 * null nếu: fetch lỗi/timeout, response không phải HTML, hoặc nội dung sau khi strip tag quá
 * ngắn (< MIN_FETCHED_TEXT_LENGTH ký tự) — dấu hiệu trang SPA render phía client.
 */
async function fetchProductFromLinkDirect(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await res.text();
    const text = stripHtml(html);
    if (text.length < MIN_FETCHED_TEXT_LENGTH) return null;

    return text.slice(0, MAX_FETCHED_TEXT_LENGTH);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Thử đọc nội dung text từ 1 link sản phẩm, 2 tầng:
 * 1. Fetch thô (nhanh, đủ dùng cho phần lớn trang server-rendered).
 * 2. Nếu tier 1 thất bại: headless browser (Playwright, xem productFetchBrowser.ts) — đọc
 *    được cả trang render bằng JS, nhưng chậm hơn (~vài giây) nên chỉ dùng khi cần. Bỏ qua
 *    tier 2 luôn cho domain đã XÁC NHẬN chặn cả headless browser (KNOWN_BLOCKED_DOMAINS) để
 *    không tốn thời gian thử vô ích.
 * Trả về null nếu cả 2 tầng đều thất bại — cần fallback: người dùng tự dán mô tả sản phẩm
 * hoặc upload ảnh/screenshot (AI vision đọc ảnh, xem productVision.ts).
 */
export async function fetchProductFromLink(url: string): Promise<string | null> {
  const direct = await fetchProductFromLinkDirect(url);
  if (direct) return direct;

  if (isKnownBlockedDomain(url)) return null;
  if (process.env.LINK_FETCH_USE_BROWSER === 'false') return null;

  const { fetchProductFromLinkViaBrowser } = await import('./productFetchBrowser');
  return fetchProductFromLinkViaBrowser(url);
}
