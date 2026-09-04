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
  onRan,
}: {
  jobId: string;
  /** Job V2 (Shopee AIDA) dùng prompt sinh kịch bản gốc khác — sai cờ này thì nút khôi phục mặc
   *  định trả về prompt của phiên bản kia. */
  isV2?: boolean;
  onRefresh: () => Promise<void>;
  /** Gọi sau khi chạy xong 1 bước — để trang cha nạp lại timeline lượt gọi AI. */
  onRan?: () => void;
}) {
  const [steps, setSteps] = useState<PromptStepView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewStep, setPreviewStep] = useState<string | null>(null);
  // Bước đang mở modal để CHẠY (khác previewStep chỉ để xem). Tách hai state vì cùng một bước có
  // thể mở ở hai chế độ, và chỉ chế độ chạy mới gắn onConfirm.
  const [runStep, setRunStep] = useState<string | null>(null);
  const [runningStep, setRunningStep] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ step: string; text: string } | null>(null);

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

  /**
   * Chạy RIÊNG một bước, không kéo theo pipeline sinh script. Kết quả hiện ngay dưới panel.
   *
   * product_lock/stage_bible tự lưu vào job nên chỉ cần onRefresh; product_visual KHÔNG lưu ở đâu
   * (xem describeProductAppearance) nên phải giữ text lại trong state để Mr.D còn đọc được.
   */
  async function handleRun(stepKey: string) {
    setRunningStep(stepKey);
    setError(null);
    setRunResult(null);
    try {
      const res = await fetch(
        `/api/livestream/${jobId}/steps/${encodeURIComponent(stepKey)}`,
        { method: 'POST' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Chạy bước thất bại (HTTP ${res.status})`);
        return;
      }
      if (stepKey === 'product_visual') {
        setRunResult({ step: stepKey, text: data.description || '(AI không trả về mô tả nào)' });
      } else if (stepKey === 'product_lock') {
        setRunResult({ step: stepKey, text: JSON.stringify(data.lock, null, 2) });
      } else {
        setRunResult({ step: stepKey, text: JSON.stringify(data.stageBible, null, 2) });
      }
      await onRefresh();
      onRan?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunningStep(null);
    }
  }

  // Chỉ những bước route preview-prompt dựng được payload — bước khác mở modal sẽ ra lỗi 400.
  const PREVIEWABLE = ['background', 'script', 'stage_bible', 'product_lock', 'product_visual', 'script_qa'];

  // Bước chạy lẻ được — phải khớp RUNNABLE_STEPS ở app/api/livestream/[id]/steps/[step]/route.ts.
  // Là tập con của PREVIEWABLE vì mọi nút chạy đều đi qua modal xem trước (check:step-run-routes
  // canh ràng buộc này).
  const RUNNABLE = ['product_visual', 'product_lock', 'stage_bible'];

  /** Lý do khoá nút chạy, hoặc undefined nếu chạy được. */
  function runDisabledReason(stepKey: string): string | undefined {
    if (stepKey === 'product_lock' && !isV2) {
      return 'Bước này chỉ áp dụng cho job Livestream Shopee V2 — job V1 không dùng khối khoá ngoại hình.';
    }
    return undefined;
  }

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
              onRun={RUNNABLE.includes(s.key) ? setRunStep : undefined}
              runDisabledReason={runDisabledReason(s.key)}
              running={runningStep === s.key}
            />
          ))}
        </>
      )}

      {runResult && (
        <div className="banner banner-info" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>Kết quả bước &quot;{runResult.step}&quot;</strong>
            <button className="btn btn-ghost" onClick={() => setRunResult(null)}>
              ✕ Đóng
            </button>
          </div>
          {runResult.step === 'product_visual' && (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Bước này KHÔNG lưu kết quả vào job — đây chỉ là bản để xem AI đọc ra gì từ ảnh. Lượt
              sinh script sau vẫn đọc lại từ đầu.
            </div>
          )}
          <pre
            style={{
              marginTop: 8,
              maxHeight: 320,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {runResult.text}
          </pre>
        </div>
      )}

      {previewStep && (
        <PromptPreviewModal
          jobId={jobId}
          step={previewStep as 'script'}
          onSaved={handleSaved}
          onClose={() => setPreviewStep(null)}
        />
      )}

      {/* Modal CHẠY: cùng component với modal xem, khác ở chỗ có onConfirm nên hiện nút chạy thật.
          Mr.D nhìn đủ prompt + ảnh rồi mới đốt lượt AI, giống mọi nút gen khác trong app. */}
      {runStep && (
        <PromptPreviewModal
          jobId={jobId}
          step={runStep as 'script'}
          confirmLabel={`▶ Chạy bước "${runStep}" ngay`}
          onConfirm={() => handleRun(runStep)}
          onSaved={handleSaved}
          onClose={() => setRunStep(null)}
        />
      )}
    </div>
  );
}
