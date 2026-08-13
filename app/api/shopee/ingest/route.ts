import { NextResponse } from 'next/server';
import { parseShopeeInitialState, pickShopeeItem, type ShopeeDomData } from '@/lib/shopee/parseInitialState';
import { saveIngest, getLatest } from '@/lib/shopee/ingestStore';

// CORS: extension gọi cross-origin từ shopee.vn tới endpoint này (local hoặc domain server).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Extension POST data sản phẩm bóc từ trang Shopee thật. */
export async function POST(req: Request) {
  let body: {
    itemId?: string | number;
    shopId?: string | number;
    initialState?: unknown;
    domData?: ShopeeDomData | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Body request không hợp lệ' }, 400);
  }

  if (!body.initialState && !body.domData) {
    return json({ ok: false, error: 'Thiếu cả initialState lẫn domData (extension chưa bóc được data từ trang)' }, 400);
  }

  const product = parseShopeeInitialState(body.initialState, body.itemId, body.domData, body.shopId);
  if (!product) {
    return json(
      { ok: false, error: 'Không tìm được dữ liệu sản phẩm trong initialState (path item.items[itemId] rỗng)' },
      422
    );
  }

  // Lưu raw = chỉ node item sản phẩm (không phải toàn bộ initialState 342KB) để tiện chẩn đoán mapping.
  const rawItem = pickShopeeItem(body.initialState, body.itemId);
  const entry = saveIngest(product.itemId, product, rawItem);
  return json({ ok: true, product, receivedAt: entry.receivedAt });
}

/** Màn hình /shopee-crawl poll để lấy sản phẩm mới nhất extension gửi về. */
export async function GET(req: Request) {
  const itemId = new URL(req.url).searchParams.get('itemId');
  const entry = getLatest(itemId);
  if (!entry) return json({ ok: true, product: null, receivedAt: null });
  return json({ ok: true, product: entry.product, raw: entry.raw, receivedAt: entry.receivedAt });
}
