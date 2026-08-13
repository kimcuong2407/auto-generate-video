'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ShopeeProductInfo } from '@/lib/shopee/types';

interface IngestResponse {
  ok: boolean;
  product?: ShopeeProductInfo | null;
  raw?: unknown;
  receivedAt?: string | null;
  error?: string;
}

const POLL_INTERVAL_MS = 2000;

function formatVnd(n: number): string {
  return n.toLocaleString('vi-VN') + '₫';
}

export default function ShopeeTestPage() {
  const [itemIdFilter, setItemIdFilter] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ShopeeProductInfo | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);

  // Giữ receivedAt mới nhất đã render trong ref để callback poll không phụ thuộc state cũ.
  const lastReceivedRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const qs = itemIdFilter.trim() ? `?itemId=${encodeURIComponent(itemIdFilter.trim())}` : '';
      const res = await fetch(`/api/shopee/ingest${qs}`);
      const data: IngestResponse = await res.json();
      if (data.ok && data.product && data.receivedAt && data.receivedAt !== lastReceivedRef.current) {
        lastReceivedRef.current = data.receivedAt;
        setProduct(data.product);
        setRaw(data.raw ?? null);
        setReceivedAt(data.receivedAt);
        setError(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, [itemIdFilter]);

  useEffect(() => {
    if (!listening) return;
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [listening, poll]);

  return (
    <div className="list-wrap">
      <div className="page-header">
        <div>
          <div className="logo">
            🛍️ <span>Shopee</span> Crawler Test
          </div>
          <Link href="/" className="back-link">
            ← Về trang chủ
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Nhận data từ Chrome Extension</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 14 }}>
          Shopee chặn crawl phía server, nên dùng Chrome Extension đọc data ngay trong tab thật của bạn:
          <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            <li>Cài extension trong thư mục <code>extension/</code> (xem <code>extension/README.md</code>).</li>
            <li>Mở 1 trang sản phẩm Shopee bất kỳ trong Chrome.</li>
            <li>Bấm icon extension → nút <strong>&quot;Gửi data&quot;</strong>.</li>
            <li>Data sẽ tự hiện bên dưới (trang này đang lắng nghe).</li>
          </ol>
        </div>
        <div className="field-group">
          <label>Lọc theo itemId (tuỳ chọn — để trống sẽ hiện sản phẩm nhận gần nhất)</label>
          <input
            type="text"
            value={itemIdFilter}
            onChange={(e) => setItemIdFilter(e.target.value)}
            placeholder="VD: 24360882365"
          />
        </div>
        <button
          className={`btn ${listening ? '' : 'btn-primary'}`}
          onClick={() => setListening((v) => !v)}
        >
          {listening ? '⏹ Dừng lắng nghe' : '📡 Bắt đầu lắng nghe data'}
        </button>
        {listening && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--amber)' }} className="pulse">
            Đang chờ extension gửi data...
          </span>
        )}
        {receivedAt && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            Nhận lúc: {new Date(receivedAt).toLocaleString('vi-VN')}
          </span>
        )}
      </div>

      {error && (
        <div className="banner" style={{ marginTop: 16 }}>
          ❌ {error}
        </div>
      )}

      {product && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            {product.name}
            {product.isOfficialShop && <span className="badge badge-done">Shop chính hãng</span>}
            {product.shopeeVerified && <span className="badge badge-pending">Shop Yêu Thích+</span>}
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {product.images.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxWidth: 420 }}>
                {product.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt={`${product.name} ${i + 1}`}
                    style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                  />
                ))}
              </div>
            )}

            <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div>
                💰 Giá:{' '}
                <strong>{product.priceText || formatVnd(product.price)}</strong>
                {product.priceMin !== product.priceMax && product.priceMin > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    ({formatVnd(product.priceMin)} - {formatVnd(product.priceMax)})
                  </span>
                )}
                {product.discountPercent > 0 && (
                  <span style={{ color: 'var(--red)' }}>
                    {' '}
                    -{product.discountPercent}% (gốc{' '}
                    {product.originalPriceText || formatVnd(product.priceBeforeDiscount)})
                  </span>
                )}
                {product.discountPercent === 0 && product.originalPriceText && (
                  <span style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                    {' '}
                    {product.originalPriceText}
                  </span>
                )}
              </div>
              <div>
                ⭐ Đánh giá:{' '}
                {product.ratingStar > 0
                  ? `${product.ratingStar.toFixed(1)}${product.ratingCount ? ` (${product.ratingCount} lượt)` : ''}`
                  : 'Chưa có đánh giá'}
              </div>
              <div>
                🛒 Đã bán: {product.soldText || product.historicalSold || product.sold || 0} · 📦 Tồn kho:{' '}
                {product.stock}
              </div>
              <div>👁️ Lượt xem: {product.viewCount} · ❤️ Yêu thích: {product.likedCount}</div>
              {product.brand && <div>🏷️ Thương hiệu: {product.brand}</div>}
              {product.categories.length > 0 && <div>📂 Danh mục: {product.categories.join(' / ')}</div>}
              <div>🚚 {product.freeShipping ? 'Có freeship' : 'Không freeship'}</div>
              <div>
                🏪 Shop: {product.shopName || `#${product.shopId}`}
                {product.shopLocation && ` · ${product.shopLocation}`}
              </div>
              <div>
                🔗{' '}
                <a href={product.productUrl} target="_blank" rel="noopener noreferrer">
                  {product.productUrl}
                </a>
              </div>
            </div>
          </div>

          {product.description && (
            <div style={{ marginTop: 16 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>
                Mô tả sản phẩm
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>
                {product.description}
              </div>
            </div>
          )}

          {product.models.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="card-header" style={{ marginBottom: 8 }}>
                Phân loại ({product.models.length})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Tên phân loại</th>
                      <th>Giá</th>
                      <th>Giá gốc</th>
                      <th>Tồn kho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.models.map((m) => (
                      <tr key={m.modelId}>
                        <td>{m.name}</td>
                        <td>{formatVnd(m.price)}</td>
                        <td>{formatVnd(m.priceBeforeDiscount)}</td>
                        <td>{m.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={() => setShowRaw((v) => !v)}>
              {showRaw ? '▲ Ẩn JSON gốc' : '▼ Xem toàn bộ JSON gốc từ Shopee'}
            </button>
            {showRaw && (
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: 11,
                  maxHeight: 500,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(raw, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
