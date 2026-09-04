'use client';

import { useEffect, useState } from 'react';
import { LIVESTREAM_V2_PLATFORMS, type LivestreamV2Input } from '@/lib/livestream/types';

const GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
};

/**
 * Form thông tin buổi live Shopee của job V2 — sửa được sau khi tạo job.
 *
 * Các giá trị này đi thẳng vào user prompt sinh kịch bản (xem lib/livestream/scriptPromptV2.ts),
 * nên sửa xong phải bấm "Sinh script" lại mới thấy tác dụng — nói rõ trên UI để không hiểu nhầm là
 * lưu xong kịch bản tự đổi theo.
 */
export function V2InputPanel({
  jobId,
  input,
  busy,
  onRefresh,
  suggestedAdvantages,
}: {
  jobId: string;
  input: LivestreamV2Input;
  busy: boolean;
  onRefresh: () => Promise<void>;
  /** Ưu điểm AI vừa bóc tách ở ProductPanel (bước 3) — đắp vào ô đang trống, chưa lưu. */
  suggestedAdvantages?: string[] | null;
}) {
  const [draft, setDraft] = useState<LivestreamV2Input>(input);
  const [advantagesText, setAdvantagesText] = useState(input.advantages.join('\n'));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chỉ đắp khi ô đang TRỐNG — không đè thứ Mr.D đã tự sửa. Vẫn phải bấm Lưu mới persist, để còn
  // xem lại trước khi ghi đè bản trên server.
  useEffect(() => {
    if (!suggestedAdvantages?.length) return;
    setAdvantagesText((prev) => (prev.trim() ? prev : suggestedAdvantages.join('\n')));
    setSaved(false);
  }, [suggestedAdvantages]);

  function set<K extends keyof LivestreamV2Input>(key: K, value: LivestreamV2Input[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const advantages = advantagesText
        .split('\n')
        .map((l) => l.replace(/^[-•*]\s*/, '').trim())
        .filter(Boolean);
      const res = await fetch(`/api/livestream/${jobId}/v2-input`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, advantages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Lưu thất bại (HTTP ${res.status})`);
        return;
      }
      setDraft(data.input);
      setAdvantagesText((data.input.advantages || []).join('\n'));
      setSaved(true);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        🛒 <span>Thông tin buổi live Shopee (V2)</span>
        <span className="badge badge-done">Kịch bản AIDA</span>
      </div>

      <div className="banner banner-info">
        Các thông tin này đi vào prompt sinh kịch bản. Sửa xong bấm <strong>Lưu</strong>, rồi bấm{' '}
        <strong>Sinh script</strong> lại thì kịch bản mới đổi theo.
      </div>

      {error && <div className="banner">❌ {error}</div>}

      <div className="field-group">
        <label>Ưu điểm sản phẩm — mỗi dòng 1 ý (AI chọn 3-5 ý mạnh nhất làm USP, mỗi USP 1 cảnh demo)</label>
        <textarea
          rows={5}
          value={advantagesText}
          onChange={(e) => {
            setAdvantagesText(e.target.value);
            setSaved(false);
          }}
          placeholder={'Tạo bọt tốt\nHỗ trợ làm sạch da\nBề mặt mềm'}
        />
      </div>

      <div style={GRID}>
        <div className="field-group">
          <label>Số câu thoại mỗi cảnh</label>
          <input
            type="number"
            min={1}
            max={5}
            value={draft.dialoguesPerScene}
            onChange={(e) => set('dialoguesPerScene', Number(e.target.value) || 3)}
          />
        </div>
        <div className="field-group">
          <label>Nền tảng / phong cách</label>
          <select value={draft.platform} onChange={(e) => set('platform', e.target.value)}>
            {/* Giá trị cũ có thể không nằm trong danh sách (nhập tay/đổi danh sách sau này) —
                thêm option riêng để không bị select tự nhảy về phần tử đầu và ghi đè mất. */}
            {!LIVESTREAM_V2_PLATFORMS.includes(draft.platform as (typeof LIVESTREAM_V2_PLATFORMS)[number]) && (
              <option value={draft.platform}>{draft.platform}</option>
            )}
            {LIVESTREAM_V2_PLATFORMS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <label>Tên kênh</label>
          <input
            type="text"
            value={draft.channelName}
            onChange={(e) => set('channelName', e.target.value)}
            placeholder="VD: Homebox - Thế Giới Tiện Ích"
          />
        </div>
        <div className="field-group">
          <label>Số follower</label>
          <input
            type="text"
            value={draft.followerCount}
            onChange={(e) => set('followerCount', e.target.value)}
            placeholder="VD: 117k follow"
          />
        </div>
        <div className="field-group">
          <label>Số người đang xem</label>
          <input
            type="text"
            value={draft.viewerCount}
            onChange={(e) => set('viewerCount', e.target.value)}
            placeholder="VD: 1K đang xem"
          />
        </div>
      </div>

      <div className="field-group">
        <label>Khuyến mãi — để trống thì AI KHÔNG được nhắc giá hay ưu đãi nào</label>
        <input
          type="text"
          value={draft.promotion}
          onChange={(e) => set('promotion', e.target.value)}
          placeholder="VD: Mua 1 tặng 1, Freeship, Voucher 20%"
        />
      </div>

      <div className="field-group">
        <label>CTA mong muốn — để trống thì AI tự tạo CTA hợp Shopee Live</label>
        <textarea
          rows={3}
          value={draft.cta}
          onChange={(e) => set('cta', e.target.value)}
          placeholder={'Comment HỒNG hoặc XANH\nBấm vào sản phẩm đang ghim'}
        />
      </div>

      <div className="step-actions">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || busy}>
          {saving ? 'Đang lưu...' : '💾 Lưu thông tin buổi live'}
        </button>
        {saved && <span style={{ color: 'var(--green)', fontSize: 13 }}>✓ Đã lưu — bấm &quot;Sinh script&quot; để áp dụng</span>}
      </div>
    </div>
  );
}
