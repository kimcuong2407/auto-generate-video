'use client';

import { useCallback, useEffect, useState } from 'react';
import { PromptStepEditor, type PromptStepView } from '@/components/prompts/PromptStepEditor';

/**
 * Khối "system prompt AI" của luồng Video Review: đúng 5 lượt gọi AI TEXT mà luồng này chạy, mỗi
 * bước sửa + lưu ngay tại chỗ.
 *
 * Vì sao lọc theo danh sách cứng thay vì hiện hết /api/prompts trả về: registry đang gộp chung cả
 * bước của luồng livestream (product_lock, stage_bible, shorten...). Hiện hết ở tab review nghĩa là
 * Mr.D sửa một prompt không bao giờ chạy ở luồng này rồi ngồi đợi kết quả đổi — im lặng, không lỗi,
 * rất khó nhận ra. Trang /settings/prompts vẫn là chỗ xem toàn bộ.
 *
 * Vì sao KHÔNG có nút "Lưu cho project này": mọi bước ở đây perJob=false — luồng review định danh
 * bằng projectId chứ không phải job slug livestream, bảng ai_prompts chưa có tầng đó. Sửa ở đây là
 * sửa bản mặc định dùng cho MỌI project review. PromptStepEditor tự ẩn nút job khi perJob=false.
 */

/** Đúng thứ tự các bước chạy trong luồng, để đọc từ trên xuống là hiểu pipeline. */
const REVIEW_STEPS = [
  'review_product_vision',
  'review_script',
  'veo_prompt_eval',
  'storyboard_prompt',
  'review_background_prompt',
] as const;

const STEP_ORDER = new Map<string, number>(REVIEW_STEPS.map((k, i) => [k, i]));

/** Bước này chạy ở Bước mấy của wizard — Mr.D đối chiếu với sidebar bên trái. */
const STEP_STAGE: Record<string, string> = {
  review_product_vision: 'Bước 1 — Upload ảnh',
  review_script: 'Bước 2 — Duyệt kịch bản',
  veo_prompt_eval: 'Bước 2 — sau khi sinh kịch bản',
  storyboard_prompt: 'Bước 3 — Storyboard ảnh',
  review_background_prompt: 'Bước 3 — Storyboard ảnh',
};

export function ReviewPromptPanel({ projectId }: { projectId: string }) {
  const [steps, setSteps] = useState<PromptStepView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setError(null);
      const all = (data.steps as PromptStepView[]).filter((s) => STEP_ORDER.has(s.key));
      all.sort((a, b) => STEP_ORDER.get(a.key)! - STEP_ORDER.get(b.key)!);
      setSteps(all);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const customized = steps?.filter((s) => s.scope !== 'default').length ?? 0;

  return (
    <div className="card">
      <div className="card-header">
        ⚙️ <span>System prompt AI của luồng review (nâng cao)</span>
      </div>

      <div className="banner banner-info">
        Chỉ dẫn hệ thống gửi cho AI ở từng bước của luồng này. Sửa xong bấm{' '}
        <strong>🌐 Lưu làm mặc định</strong> — áp cho <strong>mọi project review</strong> từ lần gen
        sau (kịch bản/ảnh đã sinh rồi không tự đổi, phải gen lại). Prompt được đọc lại ở mỗi lượt
        gen nên không cần restart app.
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {!steps && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

      {steps && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
            {steps.length} lượt gọi AI text —{' '}
            {customized > 0
              ? `${customized} bước đang dùng prompt đã tuỳ chỉnh`
              : 'tất cả đang dùng prompt gốc của hệ thống'}
          </div>
          {steps.map((s, i) => (
            <div key={s.key}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  marginTop: 10,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {STEP_STAGE[s.key]}
              </div>
              <PromptStepEditor step={s} index={i + 1} onSaved={load} projectId={projectId} />
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
        Project: <code>{projectId}</code>. Các bước gen ẢNH/VIDEO không có system prompt ở đây —
        prompt của chúng nằm ngay trên từng cảnh ở Bước 3 và Bước 4.
      </div>
    </div>
  );
}
