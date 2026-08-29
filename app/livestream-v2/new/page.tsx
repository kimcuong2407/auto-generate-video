'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { LIVESTREAM_V2_PLATFORMS } from '@/lib/livestream/types';

/** Gợi ý số cảnh theo thời lượng — bảng INPUT_7 của skill (chỉ để hiện chú thích, không ép). */
function suggestSceneCount(durationSec: number): string {
  if (durationSec <= 30) return '5-6 cảnh';
  if (durationSec <= 45) return '7-8 cảnh';
  if (durationSec <= 60) return '10 cảnh';
  if (durationSec <= 90) return '12-15 cảnh';
  return '15-20 cảnh';
}

/**
 * Ghép các trường thông tin sản phẩm thành khối text mà pipeline ingest đã biết đọc (nhánh
 * 'manual'). Tái dùng đúng đường đi của tab V1 thay vì thêm kiểu input mới ở server.
 */
function buildProductText(fields: {
  name: string;
  usage: string;
  material: string;
  size: string;
  colors: string;
  audience: string;
  howToUse: string;
  storage: string;
  advantages: string[];
}): string {
  const lines = [`Tên sản phẩm: ${fields.name}`];
  const push = (label: string, value: string) => {
    if (value.trim()) lines.push(`${label}: ${value.trim()}`);
  };
  push('Công dụng', fields.usage);
  push('Chất liệu', fields.material);
  push('Kích thước', fields.size);
  push('Màu sắc', fields.colors);
  push('Đối tượng sử dụng', fields.audience);
  push('Cách sử dụng', fields.howToUse);
  push('Cách bảo quản', fields.storage);
  if (fields.advantages.length > 0) {
    lines.push(`Ưu điểm: ${fields.advantages.join('; ')}`);
  }
  return lines.join('\n');
}

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

export default function NewLivestreamV2Page() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [advantagesText, setAdvantagesText] = useState('');
  const [usage, setUsage] = useState('');
  const [material, setMaterial] = useState('');
  const [size, setSize] = useState('');
  const [colors, setColors] = useState('');
  const [audience, setAudience] = useState('');
  const [howToUse, setHowToUse] = useState('');
  const [storage, setStorage] = useState('');

  const [durationSec, setDurationSec] = useState(60);
  const [dialoguesPerScene, setDialoguesPerScene] = useState(3);
  const [platform, setPlatform] = useState<string>(LIVESTREAM_V2_PLATFORMS[0]);
  const [channelName, setChannelName] = useState('');
  const [followerCount, setFollowerCount] = useState('');
  const [viewerCount, setViewerCount] = useState('');
  const [promotion, setPromotion] = useState('');
  const [cta, setCta] = useState('');

  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [modelFiles, setModelFiles] = useState<File[]>([]);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const advantages = advantagesText
    .split('\n')
    .map((l) => l.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Cần nhập tên sản phẩm');
      return;
    }
    setCreating(true);
    setError(null);
    setWarnings([]);
    try {
      const form = new FormData();
      form.set('name', name.trim().slice(0, 60));
      form.set('aspectRatio', '9:16');
      // Ảnh sản phẩm và ảnh MC đều vào KHO ẢNH CHUNG của job (field 'images'); việc chọn ảnh nào
      // làm tham chiếu / ảnh người dẫn làm ở phần cấu hình ảnh trong trang job — dùng lại UI đã có
      // của V1 thay vì làm bộ chọn ảnh thứ hai ở đây.
      for (const f of [...productFiles, ...modelFiles]) form.append('images', f);
      form.set(
        'entries',
        JSON.stringify([
          {
            type: 'manual',
            text: buildProductText({
              name: name.trim(),
              usage,
              material,
              size,
              colors,
              audience,
              howToUse,
              storage,
              advantages,
            }),
            targetDurationSec: durationSec,
          },
        ])
      );
      form.set(
        'v2Input',
        JSON.stringify({
          advantages,
          platform,
          channelName,
          followerCount,
          viewerCount,
          promotion,
          cta,
          dialoguesPerScene,
        })
      );

      const res = await fetch('/api/livestream', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Tạo job thất bại (HTTP ${res.status})`);
        setWarnings(data.warnings || []);
        return;
      }
      router.push(`/livestream/${data.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div>
            <div className="card-header" style={{ marginBottom: 0 }}>Tạo kịch bản Livestream Shopee</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
              Chỉ tên sản phẩm là bắt buộc. Trường nào bỏ trống thì AI sẽ không bịa thêm.
            </div>
          </div>
          <Link href="/livestream-v2" className="btn btn-ghost">← Danh sách</Link>
        </div>

        {error && <div className="banner" style={{ marginBottom: 12 }}>❌ {error}</div>}
        {warnings.length > 0 && (
          <div className="banner" style={{ marginBottom: 12 }}>⚠️ {warnings.join(' · ')}</div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">1. Sản phẩm</div>

          <div className="field-group">
            <label>Tên sản phẩm *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Bông Tắm Tròn Tạo Bọt 3D"
            />
          </div>

          <div className="field-group">
            <label>
              Ưu điểm sản phẩm — mỗi dòng 1 ý (AI chọn 3-5 ý mạnh nhất làm USP, mỗi USP có 1 cảnh demo)
              {advantages.length > 0 ? ` · đã nhận ${advantages.length} ý` : ''}
            </label>
            <textarea
              rows={5}
              value={advantagesText}
              onChange={(e) => setAdvantagesText(e.target.value)}
              placeholder={'Tạo bọt tốt\nHỗ trợ làm sạch da\nBề mặt mềm\nCó phần cầm tiện lợi'}
            />
          </div>

          <div style={GRID}>
            <div className="field-group">
              <label>Công dụng</label>
              <input type="text" value={usage} onChange={(e) => setUsage(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Chất liệu</label>
              <input type="text" value={material} onChange={(e) => setMaterial(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Kích thước</label>
              <input type="text" value={size} onChange={(e) => setSize(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Màu sắc</label>
              <input type="text" value={colors} onChange={(e) => setColors(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Đối tượng sử dụng</label>
              <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Cách sử dụng</label>
              <input type="text" value={howToUse} onChange={(e) => setHowToUse(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Cách bảo quản</label>
              <input type="text" value={storage} onChange={(e) => setStorage(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">2. Ảnh (tuỳ chọn)</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
            Ảnh sản phẩm khoá hình dạng, ảnh MC giữ khuôn mặt/trang phục xuyên suốt. Sau khi tạo job,
            vào phần cấu hình ảnh trong trang job để chọn ảnh tham chiếu và ảnh người dẫn.
          </div>

          <div className="upload-grid">
            <div className={`upload-zone${productFiles.length ? ' filled' : ''}`}>
              <label htmlFor="v2-product-images">📦 Ảnh sản phẩm (1-5 ảnh: mặt trước, mặt sau, góc nghiêng, cách dùng)</label>
              <input
                id="v2-product-images"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setProductFiles(Array.from(e.target.files || []))}
              />
              {productFiles.length > 0 && (
                <div className="filename">{productFiles.length} ảnh đã chọn</div>
              )}
            </div>

            <div className={`upload-zone${modelFiles.length ? ' filled' : ''}`}>
              <label htmlFor="v2-model-images">🧑 Ảnh người mẫu / MC</label>
              <input
                id="v2-model-images"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setModelFiles(Array.from(e.target.files || []))}
              />
              {modelFiles.length > 0 && (
                <div className="filename">{modelFiles.length} ảnh đã chọn</div>
              )}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">3. Buổi live</div>

          <div style={GRID}>
            <div className="field-group">
              <label>Thời lượng video (giây) — gợi ý {suggestSceneCount(durationSec)}, mỗi cảnh 8 giây</label>
              <input
                type="number"
                min={8}
                max={600}
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value) || 60)}
              />
            </div>
            <div className="field-group">
              <label>Số câu thoại mỗi cảnh</label>
              <input
                type="number"
                min={1}
                max={5}
                value={dialoguesPerScene}
                onChange={(e) => setDialoguesPerScene(Number(e.target.value) || 3)}
              />
            </div>
            <div className="field-group">
              <label>Nền tảng / phong cách</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {LIVESTREAM_V2_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field-group">
              <label>Tên kênh</label>
              <input
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="VD: Homebox - Thế Giới Tiện Ích"
              />
            </div>
            <div className="field-group">
              <label>Số follower</label>
              <input
                type="text"
                value={followerCount}
                onChange={(e) => setFollowerCount(e.target.value)}
                placeholder="VD: 117k follow"
              />
            </div>
            <div className="field-group">
              <label>Số người đang xem</label>
              <input
                type="text"
                value={viewerCount}
                onChange={(e) => setViewerCount(e.target.value)}
                placeholder="VD: 1K đang xem"
              />
            </div>
          </div>

          <div className="field-group">
            <label>Khuyến mãi — để trống thì AI KHÔNG được nhắc giá hay ưu đãi nào</label>
            <input
              type="text"
              value={promotion}
              onChange={(e) => setPromotion(e.target.value)}
              placeholder="VD: Mua 1 tặng 1, Freeship, Voucher 20%"
            />
          </div>

          <div className="field-group">
            <label>CTA mong muốn — để trống thì AI tự tạo CTA hợp Shopee Live</label>
            <textarea
              rows={3}
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder={'Comment HỒNG hoặc XANH\nBấm vào sản phẩm đang ghim'}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingBottom: 32 }}>
          <Link href="/livestream-v2" className="btn btn-ghost">Huỷ</Link>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? 'Đang tạo job...' : '✍️ Tạo job kịch bản'}
          </button>
        </div>
      </div>
    </div>
  );
}
