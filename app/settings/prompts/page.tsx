'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { PromptStepEditor, type PromptStepView } from '@/components/prompts/PromptStepEditor';

/**
 * Quản lý prompt MẶC ĐỊNH toàn hệ thống cho 11 bước AI của luồng livestream.
 *
 * Vì sao cần trang riêng thay vì chỉ sửa trong từng job: 3 bước (chuẩn hoá mô tả, đọc ảnh chụp màn
 * hình, bóc tách form V2) chạy TRƯỚC khi job tồn tại nên không có trang job nào để gắn vào. Ngoài
 * ra sửa bản mặc định là việc làm một lần cho mọi job sau — không nên phải mở một job bất kỳ ra
 * mới sửa được.
 *
 * Sửa ở đây KHÔNG đụng job đã có bản riêng: bản riêng của job luôn thắng, xem loadPromptSet.
 */
export default function PromptSettingsPage() {
  const [steps, setSteps] = useState<PromptStepView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Prompt sinh kịch bản có 2 bản mặc định (V1 và AIDA Shopee V2) — trang này ở cấp hệ thống,
  // không thuộc job nào, nên phải cho chọn đang xem bản nào.
  const [v2, setV2] = useState(false);
  // Chế độ debug (cờ toàn hệ thống): dừng xin duyệt trước mỗi bước AI của lượt sinh script.
  // undefined = chưa tải xong, tránh nháy checkbox từ off sang on.
  const [debugConfirm, setDebugConfirm] = useState<boolean | undefined>(undefined);
  const [savingDebug, setSavingDebug] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompts${v2 ? '?v2=1' : ''}`);
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
  }, [v2]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch('/api/ai-settings')
      .then((r) => r.json())
      .then((d) => setDebugConfirm(d.debugConfirmSteps === true))
      .catch(() => setDebugConfirm(false));
  }, []);

  async function toggleDebug(next: boolean) {
    setSavingDebug(true);
    // Cập nhật lạc quan rồi trả về giá trị server chốt — checkbox không nên đứng im chờ round-trip.
    setDebugConfirm(next);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debugConfirmSteps: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Lưu chế độ debug thất bại');
        setDebugConfirm(!next);
        return;
      }
      setDebugConfirm(data.debugConfirmSteps === true);
    } catch (err) {
      setError((err as Error).message);
      setDebugConfirm(!next);
    } finally {
      setSavingDebug(false);
    }
  }

  const customized = steps?.filter((s) => s.scope !== 'default').length ?? 0;

  return (
    <div className="page-shell">
      <TopNav />
      <div className="home-wrap">
        <div className="card">
          <div className="card-header">
            📝 <span>Prompt mặc định cho mọi project</span>
          </div>

          <div className="banner banner-info">
            Đây là chỉ dẫn hệ thống gửi cho AI ở từng bước, áp dụng cho <strong>mọi job</strong> tạo
            từ nay về sau. Job nào đã có bản prompt riêng thì vẫn giữ bản riêng của nó — sửa ở đây
            không đè lên. Viết <code>{'${ten_sanpham}'}</code> và các params khác vào prompt, hệ
            thống tự thay bằng giá trị thật của từng sản phẩm lúc gen.
          </div>

          {error && <div className="banner banner-error">{error}</div>}

          <div
            className="field-group"
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}
          >
            <label>
              <input
                type="checkbox"
                checked={debugConfirm === true}
                disabled={debugConfirm === undefined || savingDebug}
                onChange={(e) => toggleDebug(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              🐞 <strong>Chế độ debug</strong> — dừng xin xác nhận trước MỖI bước gọi AI
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Bật: mỗi lần bấm sinh script, hệ thống dừng lại ở từng bước và hiện đúng prompt sắp
              gửi để duyệt (chạy / bỏ qua) — 6 bước{' '}
              <code>product_visual → product_lock → stage_bible → script → shorten → script_qa</code>.
              Duyệt xong thấy ổn thì tắt đi, mọi job sau chạy thẳng một mạch không hỏi nữa. Không
              trả lời trong 10 phút thì bước đó tự bỏ qua để khỏi treo. Cờ này áp cho MỌI job.
            </div>
          </div>

          <div className="field-group">
            <label>
              <input
                type="checkbox"
                checked={v2}
                onChange={(e) => setV2(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Xem bản mặc định của job <strong>Livestream Shopee V2</strong> (kịch bản AIDA)
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Chỉ đổi bước &quot;Sinh kịch bản&quot;: V1 và V2 có hai prompt gốc khác nhau. Bản đã
              tuỳ chỉnh thì dùng chung cho cả hai.
            </div>
          </div>

          {!steps && !error && <div style={{ opacity: 0.7 }}>Đang tải...</div>}

          {steps && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 4px' }}>
                {steps.length} bước AI — {customized > 0 ? `${customized} bước đã tuỳ chỉnh` : 'tất cả đang dùng prompt gốc'}
              </div>
              {steps.map((s, i) => (
                <PromptStepEditor key={s.key} step={s} index={i + 1} onSaved={load} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
