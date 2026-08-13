// Content script — chạy TRONG tab Shopee thật (đã pass anti-bot). Nghe message từ popup,
// bóc object `initialState` (chứa data sản phẩm đầy đủ) từ thẻ <script> nhúng trong trang.
// Data nằm ở initialState.item.items[<itemId>], cấu trúc giống API pdp/get_pc.

// Popup tự inject file này (chrome.scripting) mỗi lần bấm để chắc chắn có "receiving end".
// Guard tránh đăng ký listener nhiều lần khi bị inject lại.
if (!window.__shopeeGrabberLoaded) {
  window.__shopeeGrabberLoaded = true;

/** Lấy { itemId, shopId } từ URL sản phẩm (2 format Shopee dùng). */
function idsFromUrl() {
  const href = location.href;
  const dash = href.match(/-i\.(\d+)\.(\d+)/);
  if (dash) return { shopId: dash[1], itemId: dash[2] };
  const prod = href.match(/\/product\/(\d+)\/(\d+)/);
  if (prod) return { shopId: prod[1], itemId: prod[2] };
  return { shopId: null, itemId: null };
}

/** Tìm thẻ <script> chứa JSON `{"initialState":...}` rồi parse ra object initialState. */
function extractInitialState() {
  const scripts = Array.from(document.querySelectorAll('script'));
  const s = scripts.find(
    (x) => x.textContent && x.textContent.includes('"initialState"') && x.textContent.includes('shopId')
  );
  if (!s) return null;
  try {
    const parsed = JSON.parse(s.textContent);
    return parsed.initialState || null;
  } catch {
    return null;
  }
}

/** Fallback: đọc trực tiếp DOM đã render nếu không bóc được initialState. */
function domFallback() {
  const pick = (needle) => {
    const el = Array.from(document.querySelectorAll('body *')).find(
      (e) => e.children.length === 0 && e.textContent.trim().includes(needle)
    );
    return el ? el.textContent.trim() : null;
  };
  const og = (prop) => document.querySelector(`meta[property="${prop}"]`)?.content || null;
  return {
    name: og('og:title'),
    image: og('og:image'),
    priceText: pick('₫'),
    bodyText: document.body.innerText.slice(0, 2000),
  };
}

// ── DOM scrape giá/rating/sold ──────────────────────────────────────────────
// Shopee CHỦ ĐỘNG XÓA giá/rating số khỏi initialState nhúng (removed_fields chứa
// product_price.*). Số này CHỈ tồn tại trên DOM đã render. Class CSS bị hash (đổi mỗi
// deploy) nên KHÔNG selector theo class — bám vào dấu hiệu bền: ký tự '₫' + line-through.

/** Chuẩn hoá "48.000₫" → 48000 (số nguyên VND). Trả 0 nếu không parse được. */
function priceTextToNumber(text) {
  if (!text) return 0;
  const digits = String(text).replace(/[^\d]/g, ''); // Shopee dùng '.' làm nghìn, bỏ hết non-digit
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

/** Lá DOM (không con) hiển thị, text chứa needle. */
function leafElementsWith(predicate) {
  return Array.from(document.querySelectorAll('body *')).filter((e) => {
    if (e.children.length !== 0) return false;
    const style = window.getComputedStyle(e);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return predicate(e);
  });
}

/**
 * Scrape giá hiện tại / giá gốc / rating / sold từ DOM.
 * - Giá: các lá text chứa '₫'. Giá gốc = lá có text-decoration line-through; giá hiện
 *   tại = lá '₫' đầu tiên KHÔNG gạch ngang (thường là chữ đỏ #ee4d2d, font to nhất).
 * - Rating: text khớp /^\d(\.\d)?$/ nằm gần nhóm sao; nếu trang ghi "No ratings yet" → ''.
 * - Sold: text kiểu "Đã bán 1,2k" / "90k+ Sold" / "1.2k đã bán".
 */
function scrapeDom() {
  const priceLeaves = leafElementsWith((e) => e.textContent.includes('₫'));

  let priceText = '';
  let originalPriceText = '';
  let bestPriceScore = -1;
  for (const el of priceLeaves) {
    const t = el.textContent.trim();
    // Chỉ nhận lá giá "thuần" (VD "48.000₫"), loại chuỗi dài như phí ship lồng trong câu.
    if (!/^[\d.,]+\s*₫$/.test(t) && !/^₫\s*[\d.,]+$/.test(t)) continue;
    const style = window.getComputedStyle(el);
    const struck = (style.textDecorationLine || style.textDecoration || '').includes('line-through');
    if (struck) {
      if (!originalPriceText) originalPriceText = t;
      continue;
    }
    // Giá hiện tại: ưu tiên chữ to nhất + màu đỏ cam Shopee (#ee4d2d).
    const size = parseFloat(style.fontSize) || 0;
    const red = /rgb\(\s*238\s*,\s*77\s*,\s*45/.test(style.color) ? 100 : 0;
    const score = size + red;
    if (score > bestPriceScore) {
      bestPriceScore = score;
      priceText = t;
    }
  }

  // Rating: tìm lá text đúng dạng "4.9" / "5". Loại "No ratings yet".
  const noRating = leafElementsWith((e) => /no ratings yet/i.test(e.textContent)).length > 0;
  let ratingText = '';
  if (!noRating) {
    const ratingLeaf = leafElementsWith((e) => /^\d(\.\d)?$/.test(e.textContent.trim())).find((e) => {
      const v = Number(e.textContent.trim());
      return v >= 0 && v <= 5; // rating sao 0..5
    });
    if (ratingLeaf) ratingText = ratingLeaf.textContent.trim();
  }

  // Sold: câu chứa "đã bán" hoặc "sold" + số (có thể kèm k/k+).
  const soldLeaf = leafElementsWith((e) => {
    const t = e.textContent.trim();
    return /(đã bán|sold)/i.test(t) && /\d/.test(t) && t.length < 40;
  })[0];
  const soldText = soldLeaf ? soldLeaf.textContent.trim() : '';

  return {
    priceText,
    originalPriceText,
    price: priceTextToNumber(priceText),
    priceBeforeDiscount: priceTextToNumber(originalPriceText),
    ratingText,
    ratingStar: ratingText ? Number(ratingText) : 0,
    soldText,
  };
}

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'GET_PRODUCT') return;
    const { itemId, shopId } = idsFromUrl();
    const initialState = extractInitialState();
    // Luôn scrape DOM — đây là nguồn DUY NHẤT cho giá/rating/sold số (Shopee strip khỏi initialState).
    let domData = null;
    try {
      domData = scrapeDom();
    } catch (e) {
      domData = null;
    }
    if (initialState) {
      sendResponse({ ok: true, itemId, shopId, initialState, domData });
    } else {
      sendResponse({ ok: false, itemId, shopId, domData, domFallback: domFallback() });
    }
    return true; // giữ kênh mở cho sendResponse
  });
}
