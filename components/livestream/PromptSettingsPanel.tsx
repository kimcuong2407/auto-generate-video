'use client';

import { useState } from 'react';
// Import từ module thuần promptDefaults (không có server-only import) để không kéo
// chatClient/node:fs vào client bundle. 3 file logic re-export cùng nguồn này.
import {
  LIVESTREAM_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  VISION_SYSTEM_PROMPT,
  PRODUCT_VISUAL_SYSTEM_PROMPT,
} from '@/lib/livestream/promptDefaults';

const readonlyTextareaStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.5,
  background: 'var(--surface2)',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 10,
  resize: 'vertical',
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  padding: '8px 0',
};

/**
 * Khối "xem tất cả system prompt AI" cho 1 job livestream. Prompt extract/vision chỉ đọc
 * (chạy tự động lúc ingest, không có điểm sửa trước generate); prompt sinh kịch bản cho phép
 * chỉnh + lưu override cấp job (PATCH /api/livestream/[id]/prompt) + khôi phục mặc định.
 */
export function PromptSettingsPanel({
  jobId,
  scriptSystemPromptOverride,
  busy,
  onRefresh,
}: {
  jobId: string;
  scriptSystemPromptOverride: string | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(scriptSystemPromptOverride ?? LIVESTREAM_SYSTEM_PROMPT);
  const [saving, setSaving] = useState(false);
  const isCustom = scriptSystemPromptOverride != null && scriptSystemPromptOverride.trim() !== '';

  async function patchPrompt(value: string | null) {
    setSaving(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/prompt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptSystemPrompt: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Lưu prompt thất bại');
        return;
      }
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setDraft(LIVESTREAM_SYSTEM_PROMPT);
    patchPrompt(null);
  }

  return (
    <div className="card">
      <div className="card-header">⚙️ <span>System prompt AI (nâng cao)</span></div>

      <div className="banner banner-info">
        Đây là chỉ dẫn hệ thống gửi cho AI ở từng bước. Bạn có thể xem để hiểu AI đang làm gì, và chỉnh
        sửa prompt <strong>sinh kịch bản</strong> nếu muốn thay đổi giọng/phong cách lời thoại. Hai prompt
        còn lại chạy tự động lúc tạo job nên chỉ để xem.
      </div>

      <details>
        <summary style={summaryStyle}>1. Chuẩn hoá mô tả (extract) — chỉ đọc</summary>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Chạy tự động khi tạo job: đọc text thô (Shopee/nhập tay) → chuẩn hoá tên + mô tả sản phẩm.
        </div>
        <textarea readOnly rows={10} value={EXTRACT_SYSTEM_PROMPT} style={readonlyTextareaStyle} />
      </details>

      <details>
        <summary style={summaryStyle}>2. Đọc ảnh sản phẩm (vision) — chỉ đọc</summary>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Chạy khi bạn tải ảnh chụp màn hình sản phẩm (VD link Shopee bị chặn): AI đọc ảnh → điền tên + mô tả.
        </div>
        <textarea readOnly rows={10} value={VISION_SYSTEM_PROMPT} style={readonlyTextareaStyle} />
      </details>

      <details>
        <summary style={summaryStyle}>3. Mô tả ngoại hình sản phẩm (từ ảnh ref) — chỉ đọc</summary>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Chạy tự động trước khi sinh kịch bản nếu job có ảnh ref sản phẩm đã chọn: đọc ảnh → mô tả
          ngoại hình vật lý (kích thước, chất liệu, cầm 1 tay hay 2 tay) để script viết cảnh cầm/thao
          tác sản phẩm chân thực hơn.
        </div>
        <textarea readOnly rows={10} value={PRODUCT_VISUAL_SYSTEM_PROMPT} style={readonlyTextareaStyle} />
      </details>

      <details open>
        <summary style={summaryStyle}>
          4. Sinh kịch bản (script) — có thể chỉnh{' '}
          <span className={`badge ${isCustom ? 'badge-running' : 'badge-pending'}`}>
            {isCustom ? 'Đã tuỳ chỉnh' : 'Đang dùng mặc định'}
          </span>
        </summary>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          Prompt cốt lõi: chỉ dẫn AI viết lời thoại + mô tả video (veoPrompt) cho từng đoạn ~8s. Chỉnh sửa
          áp dụng cho lần &quot;Sinh script&quot; kế tiếp của job này.
        </div>
        <div className="field-group">
          <textarea
            rows={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
          />
        </div>
        <div className="step-actions">
          <button
            className="btn btn-primary"
            onClick={() => patchPrompt(draft)}
            disabled={saving || busy}
            title={busy ? 'Đang có đoạn generating — không thể lưu prompt lúc này' : undefined}
          >
            {saving ? 'Đang lưu...' : '💾 Lưu prompt'}
          </button>
          <button className="btn" onClick={handleReset} disabled={saving || busy}>
            ↺ Khôi phục mặc định
          </button>
        </div>
      </details>
    </div>
  );
}
