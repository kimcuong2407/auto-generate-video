'use client';

import { useState } from 'react';
import { blocksForStep, type PromptBlockStep } from '@/lib/livestream/promptBlocks';

/**
 * Ô tick bật/tắt từng KHỐI văn bản server tự ghép vào prompt.
 *
 * Vì sao cần: prompt Mr.D viết ~450 ký tự nhưng prompt gửi AI 2.323 — server ghép thêm mô tả sản
 * phẩm, sân khấu đã chốt, chú giải ảnh. Các khối đó có lý do (chống AI bịa người dẫn/đổi món hàng)
 * nhưng trước đây muốn bỏ 1 khối phải sửa code.
 *
 * Đọc thẳng PROMPT_BLOCKS — cùng registry server dùng để quyết định gửi khối nào, nên thêm khối mới
 * không bao giờ quên cập nhật UI (cùng lý do PromptParamsHint đọc thẳng PROMPT_PARAMS).
 *
 * Lưu xong gọi onSaved() để modal nạp lại preview TỪ SERVER. Không tự cắt chuỗi ở client: prompt
 * được ghép server-side, tự ghép lại ở client là đúng cái bug "preview khác thứ gửi đi" mà
 * check-preview-prompt.ts đang khoá.
 */
export function PromptBlocksToggle({
  jobId,
  step,
  disabled,
  isV2,
  onSaved,
}: {
  jobId: string;
  step: PromptBlockStep;
  /** Danh sách khối ĐANG TẮT của job (job.disabledPromptBlocks). */
  disabled: string[];
  /** Job V1 thì các khối V2-only hiện mờ — khỏi tưởng bấm không có tác dụng là hỏng. */
  isV2?: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocks = blocksForStep(step);
  const offCount = blocks.filter((b) => disabled.includes(b.key)).length;

  async function toggle(key: string, nextEnabled: boolean) {
    // Gửi TOÀN BỘ danh sách mới (route thay cả mảng) — giữ nguyên key của bước kia, nếu không bấm
    // ở modal background sẽ xoá sạch lựa chọn của bước script.
    const next = nextEnabled ? disabled.filter((k) => k !== key) : [...new Set([...disabled, key])];
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/livestream/${jobId}/prompt-blocks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details style={{ margin: '6px 0 10px' }} open={offCount > 0}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        🧩 Khối ghép thêm vào prompt ({blocks.length})
        {offCount > 0 && (
          <span style={{ color: 'var(--accent-glow)', marginLeft: 6 }}>— đang tắt {offCount}</span>
        )}
      </summary>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0' }}>
        Ngoài prompt bạn viết ở trên, server còn ghép thêm các khối dưới đây. Bỏ tick để KHÔNG gửi
        khối đó — prompt ngắn lại, nhưng đọc kỹ phần ghi chú vì mỗi khối đều đang chặn một lỗi.
      </div>

      {error && <div className="banner banner-error" style={{ fontSize: 11 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {blocks.map((b) => {
          const off = disabled.includes(b.key);
          const notApplicable = b.v2Only && !isV2;
          return (
            <label
              key={b.key}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 12,
                opacity: notApplicable ? 0.45 : 1,
                cursor: notApplicable || saving ? 'default' : 'pointer',
              }}
              title={notApplicable ? 'Khối này chỉ có ở job V2' : undefined}
            >
              <input
                type="checkbox"
                checked={!off}
                disabled={saving || notApplicable}
                onChange={(e) => void toggle(b.key, e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <strong style={{ fontWeight: 600 }}>{b.label}</strong>
                {b.v2Only && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> · chỉ job V2</span>
                )}
                <br />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
