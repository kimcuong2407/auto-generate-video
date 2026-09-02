'use client';

import { useCallback, useEffect, useState } from 'react';
import { PromptStepEditor, type PromptStepView } from '@/components/prompts/PromptStepEditor';
import { PromptPreviewModal } from './PromptPreviewModal';

/**
 * Khối "system prompt AI" của MỘT job livestream: cả 11 bước gọi AI, mỗi bước sửa được với 2 phạm
 * vi (riêng job này / mặc định cho mọi project).
 *
 * Trước đây panel này hiển thị 3 prompt read-only + 2 prompt sửa được, đọc thẳng từ field của job.
 * Nay mọi prompt đi qua /api/prompts (bảng ai_prompts) nên panel chỉ còn là danh sách —
 * PromptStepEditor lo phần sửa/lưu, dùng chung với trang /settings/prompts.
 *
 * Vì sao KHÔNG đọc prompt từ object `job` nữa: prompt giờ có 2 tầng, và tầng nào đang thắng là
 * việc của server tính. Đọc field cũ trên job sẽ hiện sai ngay khi có bản mặc định toàn hệ thống.
 */
export function PromptSettingsPanel({
  jobId,
  isV2,
  onRefresh,
}: {
  jobId: string;
  /** Job V2 (Shopee AIDA) dùng prompt sinh kịch bản gốc khác — sai cờ này thì nút khôi phục mặc
   *  định trả về prompt của phiên bản kia. */
  isV2?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [steps, setSteps] = useState<PromptStepView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewStep, setPreviewStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompts?jobSlug=${encodeURIComponent(jobId)}${isV2 ? '&v2=1' : ''}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setError(null);
      setSteps(data.steps);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [jobId, isV2]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaved() {
    await load();
    // Job cũng phải nạp lại: ô sửa prompt background ở JobImagePanel đọc từ job.
    await onRefresh();
  }

  const jobCustom = steps?.filter((s) => s.scope === 'job').length ?? 0;

  // Chỉ những bước route preview-prompt dựng được payload — bước khác mở modal sẽ ra lỗi 400.
  const PREVIEWABLE = ['background', 'script', 'stage_bible', 'product_lock', 'product_visual', 'script_qa'];

  return (
    <div className="card">
      <div className="card-header">⚙️ <span>System prompt AI (nâng cao)</span></div>

      <div className="banner banner-info">
        Chỉ dẫn hệ thống gửi cho AI ở từng bước. Sửa xong bấm <strong>💾 Lưu cho job này</strong> để
        chỉ áp cho job đang mở, hoặc <strong>🌐 Lưu làm mặc định</strong> để áp cho mọi job tạo sau.
        Viết <code>{'${ten_sanpham}'}</code> và các params khác vào prompt, hệ thống tự thay bằng
        giá trị thật của từng sản phẩm lúc gen.
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {!steps && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

      {steps && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            {steps.length} bước AI —{' '}
            {jobCustom > 0
              ? `${jobCustom} bước có prompt riêng cho job này`
              : 'job này đang dùng prompt mặc định'}
          </div>
          {steps.map((s, i) => (
            <PromptStepEditor
              key={s.key}
              step={s}
              jobSlug={jobId}
              index={i + 1}
              onSaved={handleSaved}
              onPreview={PREVIEWABLE.includes(s.key) ? setPreviewStep : undefined}
            />
          ))}
        </>
      )}

      {previewStep && (
        <PromptPreviewModal
          jobId={jobId}
          step={previewStep as 'script'}
          onSaved={handleSaved}
          onClose={() => setPreviewStep(null)}
        />
      )}
    </div>
  );
}
