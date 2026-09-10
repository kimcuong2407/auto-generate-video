'use client';

import { useCallback, useEffect, useState } from 'react';
import { PromptStepEditor, type PromptStepView } from '@/components/prompts/PromptStepEditor';

/**
 * Khối "system prompt AI" gắn ngay trong bước dùng nó — sửa prompt và xem kết quả ở cùng một chỗ,
 * không phải nhảy sang trang khác rồi quay lại đối chiếu.
 *
 * Vì sao lọc theo danh sách CỨNG truyền từ ngoài vào thay vì hiện hết /api/prompts trả về:
 * registry gộp chung cả bước của luồng livestream (product_lock, stage_bible, shorten...). Hiện
 * nhầm một bước không chạy ở luồng review nghĩa là Mr.D sửa nó rồi ngồi đợi kết quả đổi — im lặng,
 * không lỗi, rất khó nhận ra. check:review-prompt-panel canh danh sách này khớp mã nguồn thật.
 *
 * Vì sao KHÔNG có nút "Lưu cho project này": mọi bước ở đây perJob=false — luồng review định danh
 * bằng projectId chứ không phải job slug livestream, bảng ai_prompts chưa có tầng đó. Sửa ở đây là
 * sửa bản mặc định dùng cho MỌI project review. PromptStepEditor tự ẩn nút job khi perJob=false.
 *
 * THU GỌN mặc định (<details>): prompt sinh kịch bản dài 14k ký tự, mở sẵn là đẩy toàn bộ nội dung
 * thật của bước xuống dưới màn hình.
 */

/**
 * Toàn bộ bước AI text của luồng review, theo đúng thứ tự chạy. Mỗi bước khai báo nó thuộc bước
 * nào của wizard — nguồn sự thật DUY NHẤT cho việc bước nào hiện ở đâu, để không có prompt nào bị
 * bỏ quên không nơi hiển thị sau khi bỏ mục "Prompt AI" gộp chung.
 */
export const REVIEW_PROMPT_STEPS = [
  { key: 'review_product_vision', wizardStep: 1 },
  { key: 'review_script', wizardStep: 2 },
  { key: 'veo_prompt_eval', wizardStep: 2 },
  { key: 'storyboard_prompt', wizardStep: 3 },
  { key: 'review_background_prompt', wizardStep: 3 },
] as const;

/** Các key AI text thuộc 1 bước wizard. Dùng ở call-site để khỏi gõ tay danh sách rồi gõ sai. */
export function promptKeysForStep(wizardStep: number): string[] {
  return REVIEW_PROMPT_STEPS.filter((s) => s.wizardStep === wizardStep).map((s) => s.key);
}

export function ReviewPromptPanel({
  projectId,
  /** Chỉ hiện đúng những bước này (xem promptKeysForStep). */
  stepKeys,
  /** Nhãn khối, mặc định nêu rõ đây là phần nâng cao. */
  title = '⚙️ System prompt AI của bước này (nâng cao)',
}: {
  projectId: string;
  stepKeys: string[];
  title?: string;
}) {
  const [steps, setSteps] = useState<PromptStepView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Chỉ gọi API khi Mr.D thật sự mở khối ra: mỗi lượt trả về cả 16 prompt (~40k ký tự), tải sẵn
  // ở mọi bước là kéo thừa dữ liệu cho thứ phần lớn thời gian không ai mở.
  const [opened, setOpened] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/prompts');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setError(null);
      const order = new Map(stepKeys.map((k, i) => [k, i]));
      const picked = (data.steps as PromptStepView[]).filter((s) => order.has(s.key));
      picked.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
      setSteps(picked);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [stepKeys]);

  useEffect(() => {
    if (opened && steps === null) void load();
  }, [opened, steps, load]);

  const customized = steps?.filter((s) => s.scope !== 'default').length ?? 0;

  return (
    <details
      className="card"
      style={{ marginTop: 16 }}
      onToggle={(e) => setOpened((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
        {title}
        {customized > 0 && (
          <span className="badge badge-running" style={{ marginLeft: 8 }}>
            {customized} đã tuỳ chỉnh
          </span>
        )}
      </summary>

      <div className="banner banner-info" style={{ marginTop: 10 }}>
        Chỉ dẫn hệ thống gửi cho AI ở bước này. Sửa xong bấm <strong>🌐 Lưu làm mặc định</strong> —
        áp cho <strong>mọi project review</strong> từ lần gen sau (nội dung đã sinh rồi không tự
        đổi, phải gen lại). Prompt đọc lại ở mỗi lượt gen nên không cần restart app.
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {opened && !steps && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

      {steps?.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Bước này không có lượt gọi AI text nào.
        </div>
      )}

      {steps?.map((s, i) => (
        <PromptStepEditor
          key={s.key}
          step={s}
          index={i + 1}
          onSaved={load}
          projectId={projectId}
        />
      ))}
    </details>
  );
}
