'use client';

import { useState } from 'react';
import { PromptParamsHint } from '@/components/livestream/PromptParamsHint';
import { AiCallLogView } from './AiCallLogView';

/** 1 bước prompt do GET /api/prompts trả về. */
export interface PromptStepView {
  key: string;
  label: string;
  hint: string;
  perJob: boolean;
  params: 'script' | 'visual' | 'none';
  /** Prompt đang thực sự có hiệu lực (đã tính cả 2 tầng), còn nguyên ${params}. */
  effective: string;
  scope: 'job' | 'global' | 'default';
  jobBody?: string;
  globalBody?: string;
  /** Hằng mặc định trong code — thứ sẽ quay về khi bấm khôi phục. */
  fallback: string;
}

const SCOPE_BADGE: Record<PromptStepView['scope'], { text: string; cls: string }> = {
  job: { text: 'Riêng job này', cls: 'badge-running' },
  global: { text: 'Mặc định đã tuỳ chỉnh', cls: 'badge-running' },
  default: { text: 'Mặc định hệ thống', cls: 'badge-pending' },
};

/**
 * Một khối sửa prompt của MỘT bước AI — dùng chung ở trang /settings/prompts (chỉ tầng mặc định)
 * và panel trong 1 job (có thêm nút lưu riêng job).
 *
 * Hai nút lưu tách riêng thay vì 1 nút + ô tick phạm vi: bấm nhầm "lưu cho mọi project" khi đang
 * vội thì prompt của MỌI job sau đó đổi theo, mà không có dấu hiệu nào ngay lúc bấm.
 *
 * Ô sửa luôn hiện bản CÒN NGUYÊN ${params} — bản đã thay giá trị chỉ để xem ở khung preview. Sửa
 * trên bản đã thay thì lần lưu sau params biến mất vĩnh viễn khỏi prompt.
 */
export function PromptStepEditor({
  step,
  jobSlug,
  index,
  onSaved,
  onPreview,
  onRun,
  runDisabledReason,
  running,
}: {
  step: PromptStepView;
  /** Có = đang ở trong 1 job, hiện thêm nút "Lưu cho job này". */
  jobSlug?: string;
  /** Số thứ tự hiển thị trước nhãn. */
  index?: number;
  onSaved: () => void | Promise<void>;
  /** Có = hiện nút xem prompt đã ghép params + ảnh ref của bước này. */
  onPreview?: (stepKey: string) => void;
  /** Có = hiện nút CHẠY RIÊNG bước này (không kéo theo cả pipeline sinh script). */
  onRun?: (stepKey: string) => void;
  /** Có = nút chạy bị khoá, và đây là lý do hiện trong tooltip (VD bước chỉ dành cho job V2). */
  runDisabledReason?: string;
  /** Bước này đang chạy — khoá nút và đổi nhãn. */
  running?: boolean;
}) {
  // null = chưa sửa gì → hiện bản đang có hiệu lực. Chuỗi rỗng là giá trị hợp lệ (tắt hẳn) nên
  // KHÔNG dùng `|| effective`.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? step.effective;
  const badge = SCOPE_BADGE[step.scope];
  const canSaveJob = !!jobSlug && step.perJob;

  async function save(scope: 'job' | 'global', body: string | null) {
    setSaving(true);
    try {
      const res = await fetch('/api/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: step.key,
          body,
          jobSlug: scope === 'job' ? jobSlug : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Lưu prompt thất bại');
        return;
      }
      setDraft(null);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <details style={{ borderTop: '1px solid var(--border)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '10px 0' }}>
        {index != null && `${index}. `}
        {step.label} <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </summary>

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{step.hint}</div>

      {!step.perJob && jobSlug && (
        <div className="banner banner-info" style={{ fontSize: 12 }}>
          Bước này chạy TRƯỚC khi job tồn tại nên không có bản riêng cho job — sửa ở đây là sửa bản
          mặc định dùng cho mọi lần tạo job sau.
        </div>
      )}

      {step.params !== 'none' && (
        <PromptParamsHint step={step.params === 'script' ? 'script' : 'background'} />
      )}

      <textarea
        rows={14}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
      />

      <div className="step-actions" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        {canSaveJob && (
          <button
            className="btn btn-primary"
            disabled={saving}
            onClick={() => save('job', value)}
            title="Chỉ áp cho job này, không ảnh hưởng job khác"
          >
            {saving ? 'Đang lưu...' : '💾 Lưu cho job này'}
          </button>
        )}
        <button
          className={canSaveJob ? 'btn' : 'btn btn-primary'}
          disabled={saving}
          onClick={() => save('global', value)}
          title="Áp cho mọi job từ nay về sau (job đã có bản riêng vẫn giữ bản riêng)"
        >
          {saving ? 'Đang lưu...' : '🌐 Lưu làm mặc định'}
        </button>

        {/* Khôi phục = XOÁ override của đúng tầng đang thắng, để rơi xuống tầng dưới. Xoá bản job
            thì về bản mặc định; xoá bản mặc định thì về hằng trong code. */}
        {step.scope !== 'default' && (
          <button
            className="btn btn-ghost"
            disabled={saving}
            onClick={() => save(step.scope === 'job' ? 'job' : 'global', null)}
            title={
              step.scope === 'job'
                ? 'Xoá bản riêng của job này, quay về bản mặc định'
                : 'Xoá bản mặc định đã tuỳ chỉnh, quay về prompt gốc của hệ thống'
            }
          >
            ↺ {step.scope === 'job' ? 'Bỏ bản riêng của job' : 'Về prompt gốc'}
          </button>
        )}

        {draft !== null && (
          <button className="btn btn-ghost" disabled={saving} onClick={() => setDraft(null)}>
            Huỷ sửa
          </button>
        )}

        {onPreview && (
          <button className="btn btn-ghost" disabled={saving} onClick={() => onPreview(step.key)}>
            👁 Xem prompt + ảnh gửi AI
          </button>
        )}

        {onRun && (
          <button
            className="btn btn-primary"
            disabled={saving || running || !!runDisabledReason}
            onClick={() => onRun(step.key)}
            title={runDisabledReason || 'Chạy RIÊNG bước này — không sinh lại script của sản phẩm nào'}
          >
            {running ? '⏳ Đang chạy...' : '▶ Chạy riêng bước này'}
          </button>
        )}
      </div>

      {/* Input/output THẬT của các lượt đã chạy — đặt ở đây (không phải ở panel) để cả trang
          /settings/prompts lẫn panel trong job đều có, mà chỉ cắm một chỗ.

          Truyền jobSlug cho MỌI bước, kể cả perJob=false: các bước chạy trước khi job tồn tại
          (chuẩn hoá mô tả, đọc ảnh screenshot, bóc tách form V2) nay cũng có log gắn vào job —
          hoặc nhận slug ngay lúc ingest, hoặc được gán lại lúc tạo job (xem claimAiCallLogs).
          Ở trang /settings/prompts không có jobSlug thì rơi về phạm vi toàn hệ thống như cũ. */}
      <AiCallLogView stepKey={step.key} jobSlug={jobSlug} />

      {/* Job đang dùng bản riêng thì bản mặc định vẫn tồn tại phía dưới — cho xem để biết mình đang
          lệch khỏi cái gì trước khi quyết định bỏ bản riêng. */}
      {step.scope === 'job' && step.globalBody !== undefined && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
            So với bản mặc định đang dùng cho các job khác
          </summary>
          <textarea
            readOnly
            rows={8}
            value={step.globalBody}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.5,
              background: 'var(--surface2)',
              color: 'var(--text-muted)',
              marginTop: 6,
            }}
          />
        </details>
      )}
    </details>
  );
}
