'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TopNav } from '@/components/TopNav';
import type { ShopeeProductInfo } from '@/lib/shopee/types';
import {
  shopeeToLivestreamText,
  shopeeToProductInfo,
  shopeeToV2Prefill,
  SHOPEE_V2_PREFILL_KEY,
} from '@/lib/shopee/toProjectPayload';
import { MediaModal } from '@/components/MediaModal';

// Số ảnh tối đa gửi lên /api/projects (khớp MAX_IMAGE_COUNT server-side). Không import từ
// @/lib/constants vì file đó dùng node:path (server-only), sẽ vỡ bundle client component này.
const MAX_IMAGE_COUNT = 10;

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

/** 1 ảnh sản phẩm trong danh sách chỉnh sửa được — hoặc URL (từ Shopee/tự dán) hoặc file tải từ máy. */
type ImageItem =
  | { id: string; kind: 'url'; url: string }
  | { id: string; kind: 'file'; url: string; file: File };

function revokeFileUrls(items: ImageItem[]): void {
  for (const it of items) {
    if (it.kind === 'file') URL.revokeObjectURL(it.url);
  }
}

export default function ShopeeCrawlPage() {
  const router = useRouter();
  const [itemIdFilter, setItemIdFilter] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ShopeeProductInfo | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);

  // Trạng thái khởi tạo project từ data crawl.
  const [creating, setCreating] = useState<'livestream' | 'v2' | 'project' | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdLivestreamId, setCreatedLivestreamId] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  // Danh sách ảnh sản phẩm chỉnh sửa được (sửa URL, xoá, thêm ảnh) trước khi bấm tạo project.
  // Khởi tạo lại mỗi khi nhận sản phẩm mới từ extension.
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const imageIdCounterRef = useRef(0);
  const imageItemsRef = useRef<ImageItem[]>([]);
  useEffect(() => {
    imageItemsRef.current = imageItems;
  }, [imageItems]);
  // Thu hồi mọi object URL (ảnh tải từ máy) còn sót khi rời trang.
  useEffect(() => {
    return () => revokeFileUrls(imageItemsRef.current);
  }, []);
  function nextImageId(): string {
    imageIdCounterRef.current += 1;
    return `img-${imageIdCounterRef.current}`;
  }

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
        setImageItems((prev) => {
          revokeFileUrls(prev);
          return data.product!.images.map((url) => ({ id: nextImageId(), kind: 'url' as const, url }));
        });
        // Sản phẩm mới → xoá kết quả khởi tạo cũ để tránh nhầm link project của sản phẩm trước.
        setCreatedLivestreamId(null);
        setCreatedProjectId(null);
        setCreateError(null);
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

  function updateImageUrl(id: string, url: string) {
    setImageItems((prev) => prev.map((it) => (it.id === id ? { ...it, url } : it)));
  }

  function removeImageItem(id: string) {
    setImageItems((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target?.kind === 'file') URL.revokeObjectURL(target.url);
      return prev.filter((it) => it.id !== id);
    });
  }

  function addImageUrl() {
    const url = newImageUrl.trim();
    if (!url) return;
    setImageItems((prev) =>
      prev.length >= MAX_IMAGE_COUNT ? prev : [...prev, { id: nextImageId(), kind: 'url', url }]
    );
    setNewImageUrl('');
  }

  function addImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImageItems((prev) => {
      const room = MAX_IMAGE_COUNT - prev.length;
      if (room <= 0) return prev;
      const added = Array.from(files)
        .slice(0, room)
        .map((file) => ({ id: nextImageId(), kind: 'file' as const, url: URL.createObjectURL(file), file }));
      return [...prev, ...added];
    });
  }

  async function createLivestream() {
    if (!product) return;
    setCreating('livestream');
    setCreateError(null);
    try {
      const form = new FormData();
      form.set('name', product.name.slice(0, 60) || 'Livestream Shopee');
      form.set('aspectRatio', '9:16');
      // Kho ảnh sản phẩm: ảnh URL (crawl/dán) đưa qua entry.imageUrls; ảnh từ máy đưa qua field 'images'.
      const imageUrls = imageItems.filter((it) => it.kind === 'url').map((it) => it.url.trim()).filter(Boolean);
      for (const item of imageItems) {
        if (item.kind === 'file') form.append('images', item.file);
      }
      form.set(
        'entries',
        JSON.stringify([
          {
            type: 'manual',
            text: shopeeToLivestreamText(product),
            targetDurationSec: 60,
            imageUrls,
            // JSON gốc Shopee gửi kèm để lưu bền cùng sản phẩm — ingestStore là in-memory nên
            // dữ liệu này mất khi PM2 reload; không gửi bây giờ là mất hẳn cơ hội đối chiếu.
            sourceRaw: raw ?? undefined,
          },
        ])
      );
      const res = await fetch('/api/livestream', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Tạo job livestream thất bại');
        return;
      }
      setCreatedLivestreamId(data.id);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(null);
    }
  }

  /**
   * Sang form kịch bản Shopee V2 với dữ liệu đã điền sẵn.
   *
   * Crawl chỉ cho sẵn được tên/màu/tên kênh/khuyến mãi; công dụng, chất liệu, kích thước, đối
   * tượng nằm lẫn trong mô tả dạng văn xuôi nên cần 1 lượt AI tách. Lượt AI này best-effort —
   * hỏng thì vẫn chuyển trang với phần map thô, Mr.D tự điền nốt, hơn là nút bấm không làm gì.
   */
  async function goToV2Form() {
    if (!product) return;
    setCreating('v2');
    setCreateError(null);
    try {
      const prefill = shopeeToV2Prefill(product, raw ?? undefined);
      // Ảnh người dùng tự dán thêm ở danh sách trên cũng đưa sang (chỉ ảnh URL — file từ máy không
      // qua được sessionStorage, Mr.D chọn lại ở form).
      const extraUrls = imageItems.filter((it) => it.kind === 'url').map((it) => it.url.trim()).filter(Boolean);
      if (extraUrls.length > 0) prefill.imageUrls = extraUrls;

      try {
        const res = await fetch('/api/livestream/v2-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: prefill.rawText }),
        });
        if (res.ok) {
          const { fields } = await res.json();
          if (fields) {
            // AI chỉ ĐẮP vào ô còn trống, không ghi đè dữ liệu Shopee chắc chắn đúng (tên, màu).
            prefill.name = prefill.name || fields.name || '';
            prefill.colors = prefill.colors || fields.colors || '';
            prefill.advantages = fields.advantages || [];
            prefill.usage = fields.usage || '';
            prefill.material = fields.material || '';
            prefill.size = fields.size || '';
            prefill.audience = fields.audience || '';
            prefill.howToUse = fields.howToUse || '';
            prefill.storage = fields.storage || '';
          }
        }
      } catch {
        // bỏ qua — chuyển trang với phần map thô.
      }

      // sessionStorage giới hạn ~5MB: JSON gốc Shopee to có thể làm setItem ném QuotaExceeded và
      // mất SẠCH prefill. Bỏ sourceRaw rồi thử lại — mất phần đối chiếu còn hơn mất cả form.
      try {
        sessionStorage.setItem(SHOPEE_V2_PREFILL_KEY, JSON.stringify(prefill));
      } catch {
        sessionStorage.setItem(
          SHOPEE_V2_PREFILL_KEY,
          JSON.stringify({ ...prefill, sourceRaw: undefined })
        );
      }
      router.push('/livestream-v2/new');
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(null);
    }
  }

  async function createProject() {
    if (!product) return;
    if (imageItems.length === 0) {
      setCreateError('Cần ít nhất 1 ảnh sản phẩm');
      return;
    }
    setCreating('project');
    setCreateError(null);
    try {
      const form = new FormData();
      form.set('name', product.name.slice(0, 60) || 'Review Shopee');
      form.set('aspectRatio', '9:16');
      form.set('product', JSON.stringify(shopeeToProductInfo(product)));
      // Template để trống → server dùng public/default-template.json.
      for (const item of imageItems) {
        if (item.kind === 'file') form.append('images', item.file);
        else if (item.url.trim()) form.append('imageUrls', item.url.trim());
      }
      const res = await fetch('/api/projects', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Tạo project video review thất bại');
        return;
      }
      setCreatedProjectId(data.id);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div>
            <div className="card-header" style={{ marginBottom: 0 }}>🛍️ Shopee Crawl</div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {imageItems.map((item, i) => (
                  <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 96 }}>
                    <div style={{ position: 'relative', width: 96, height: 96 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={`${product.name} ${i + 1}`}
                        onClick={() => setPreviewSrc(item.url)}
                        title="Bấm để xem chi tiết"
                        style={{
                          width: 96,
                          height: 96,
                          objectFit: 'cover',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          cursor: 'zoom-in',
                        }}
                      />
                      <button
                        onClick={() => removeImageItem(item.id)}
                        title="Xoá ảnh này"
                        style={{
                          position: 'absolute',
                          top: -6,
                          right: -6,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--red)',
                          fontSize: 11,
                          lineHeight: 1,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    {item.kind === 'url' ? (
                      <input
                        type="text"
                        value={item.url}
                        title={item.url}
                        onChange={(e) => updateImageUrl(item.id, e.target.value)}
                        style={{ fontSize: 9, fontFamily: 'monospace', width: '100%', padding: '2px 4px' }}
                      />
                    ) : (
                      <span
                        title={item.file.name}
                        style={{ fontSize: 9, color: 'var(--text-muted)', wordBreak: 'break-all' }}
                      >
                        📁 {item.file.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Dán URL ảnh mới rồi bấm Thêm..."
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addImageUrl()}
                  disabled={imageItems.length >= MAX_IMAGE_COUNT}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button
                  className="btn"
                  onClick={addImageUrl}
                  disabled={imageItems.length >= MAX_IMAGE_COUNT || !newImageUrl.trim()}
                >
                  + URL
                </button>
                <label className="btn" style={{ cursor: 'pointer', margin: 0 }}>
                  📁 Từ máy
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    disabled={imageItems.length >= MAX_IMAGE_COUNT}
                    onChange={(e) => {
                      addImageFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {imageItems.length}/{MAX_IMAGE_COUNT} ảnh — sửa/xoá/thêm tự do, dùng khi bấm &quot;Tạo project Video
                Review&quot; bên dưới. Bấm vào ảnh để xem chi tiết.
              </span>
            </div>

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

          {/* Khởi tạo project từ data crawl */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="card-header" style={{ marginBottom: 10 }}>
              🚀 Khởi tạo project từ sản phẩm này
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={createLivestream} disabled={creating !== null}>
                {creating === 'livestream' ? 'Đang tạo...' : '📡 Tạo job Livestream'}
              </button>
              <button className="btn btn-primary" onClick={goToV2Form} disabled={creating !== null}>
                {creating === 'v2' ? 'Đang tách thông tin...' : '🛒 Tạo kịch bản Shopee V2'}
              </button>
              <button className="btn btn-primary" onClick={createProject} disabled={creating !== null}>
                {creating === 'project' ? 'Đang tạo...' : '🎬 Tạo project Video Review'}
              </button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 8 }}>
              Cả ba đều tải danh sách ảnh phía trên về làm kho ảnh sản phẩm. Với Livestream, vào màn chi tiết chọn 1
              ảnh làm tham chiếu rồi gen video. Video Review dùng template mặc định (chỉnh lại ở Bước 1 nếu cần).
              Kịch bản Shopee V2 mở form đã điền sẵn (AI tách công dụng/chất liệu/kích thước từ mô tả) để bạn
              bổ sung follower, người xem và CTA trước khi tạo job.
            </span>

            {createError && (
              <div className="banner" style={{ marginTop: 12 }}>
                ❌ {createError}
              </div>
            )}
            {createdLivestreamId && (
              <div className="banner banner-info" style={{ marginTop: 12 }}>
                ✅ Đã tạo job Livestream.{' '}
                <Link href={`/livestream/${createdLivestreamId}`}>Mở job →</Link>
              </div>
            )}
            {createdProjectId && (
              <div className="banner banner-info" style={{ marginTop: 12 }}>
                ✅ Đã tạo project Video Review.{' '}
                <Link href={`/projects/${createdProjectId}`}>Mở project →</Link>
              </div>
            )}
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

      {previewSrc && (
        <MediaModal kind="image" src={previewSrc} alt={product?.name} onClose={() => setPreviewSrc(null)} />
      )}
      </div>
    </div>
  );
}
