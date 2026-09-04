'use client';

import { useCallback, useEffect, useState } from 'react';
import { PROMPT_STEPS } from '@/lib/livestream/promptSteps';

/**
 * Timeline GỘP mọi lượt gọi AI của một job, sắp theo thời gian — soi cả pipeline một lượt.
 *
 * Vì sao cần bên cạnh mục thu gọn trong từng bước: một job đi qua tới 6-7 bước AI, mỗi bước lại
 * chạy theo từng sản phẩm. Muốn biết "vì sao kịch bản ra thế này" thì phải đọc theo THỨ TỰ chạy
 * (chuẩn hoá mô tả → tả ngoại hình → chốt sân khấu → sinh kịch bản → rút gọn → kiểm duyệt), chứ
 * mở lẻ từng bước trong panel prompt thì không thấy được mạch nhân quả đó.
 *
 * Gồm cả các bước chạy TRƯỚC khi job tồn tại (bóc tách form Shopee ở trang crawl, chuẩn hoá mô tả
 * lúc ingest) — chúng được gán về job lúc tạo, xem claimAiCallLogs().
 *
 * Chỉ tải nội dung của lượt Mr.D bấm vào: 1 lượt sinh kịch bản ~60k ký tự, tải sẵn cả timeline là
 * treo tab.
 */

const STEP_LABEL = new Map(PROMPT_STEPS.map((s) => [s.key as string, s.label]));

interface RunMeta {
  rowId: number;
  stepKey: string;
  createdAt: string;
  durationMs: number;
  attempts: number;
  model: string;
  promptScope: string;
  productId: string;
  imageCount: number;
  outputLength: number;
  ok: boolean;
}

interface RunDetail extends RunMeta {
  systemPrompt: string;
  userPrompt: string;
  output: string | null;
  errorMessage: string | null;
  imagePaths: string[] | null;
}

/** "2026-09-03 14:32:07.123" → "14:32:07 03/09". Dữ liệu từ DB nên định dạng cố định, cắt là đủ. */
function shortTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${m[4]} ${m[3]}/${m[2]}` : iso;
}

export function AiRunTimeline({
  jobId,
  reloadKey,
}: {
  jobId: string;
  /** Tăng giá trị này để ép nạp lại — timeline vốn chỉ load 1 lần lúc mount, nên sau khi chạy một
   *  bước AI ở panel khác sẽ không thấy lượt vừa chạy nếu không có cờ này. */
  reloadKey?: number;
}) {
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-logs?jobSlug=${encodeURIComponent(jobId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Sắp TĂNG dần: đọc theo đúng thứ tự pipeline đã chạy, không phải mới nhất trước.
      setRuns([...(data.runs as RunMeta[])].reverse());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // reloadKey nằm trong deps để đổi giá trị là chạy lại — nó không được dùng trong thân hàm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, reloadKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rowId: number) {
    if (openRow === rowId) {
      setOpenRow(null);
      return;
    }
    setOpenRow(rowId);
    setDetail(null);
    try {
      const res = await fetch(`/api/ai-logs?jobSlug=${encodeURIComponent(jobId)}&id=${rowId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(data.run);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        🧠 <span>Các lượt gọi AI của job này ({runs?.length ?? 0})</span>
        <button className="btn btn-sm" onClick={() => void load()} style={{ marginLeft: 'auto' }}>
          ↻ Tải lại
        </button>
      </div>

      <div className="banner banner-info">
        Input/output THẬT đã gửi/nhận ở từng bước, sắp theo thứ tự chạy. Bấm một dòng để xem prompt
        và kết quả thô — kể cả các bước chạy trước khi job được tạo.
      </div>

      {loading && <div style={{ opacity: 0.7 }}>Đang tải...</div>}
      {error && <div className="banner banner-error">{error}</div>}

      {runs?.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Chưa có lượt gọi AI nào được ghi cho job này. Log chỉ ghi từ thời điểm bật tính năng — job
          tạo trước đó không có dấu vết.
        </div>
      )}

      {runs?.map((r, i) => (
        <div key={r.rowId} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
          <button
            onClick={() => void toggle(r.rowId)}
            style={{
              width: '100%',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              padding: '8px 4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
              color: 'inherit',
              fontSize: 13,
            }}
          >
            <span style={{ opacity: 0.5, minWidth: 20 }}>{i + 1}.</span>
            <span style={{ fontWeight: 600 }}>{STEP_LABEL.get(r.stepKey) ?? r.stepKey}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {shortTime(r.createdAt)} · {(r.durationMs / 1000).toFixed(1)}s
              {r.attempts > 1 && ` · ${r.attempts} lần thử`}
              {r.imageCount > 0 && ` · ${r.imageCount} ảnh`}
            </span>
            <span style={{ marginLeft: 'auto' }}>{r.ok ? '✅' : '❌'}</span>
            <span style={{ opacity: 0.5 }}>{openRow === r.rowId ? '▲' : '▼'}</span>
          </button>

          {openRow === r.rowId && (
            <div style={{ paddingBottom: 10 }}>
              {!detail && <div style={{ fontSize: 12, opacity: 0.7 }}>Đang tải nội dung...</div>}
              {detail && detail.rowId === r.rowId && (
                <>
                  <div className="source-compare">
                    <div className="source-compare-col">
                      <div className="source-compare-head">
                        ① INPUT — system prompt (đã ghép {'${params}'})
                      </div>
                      <pre>{detail.systemPrompt}</pre>
                    </div>
                    <div className="source-compare-col">
                      <div className="source-compare-head">② INPUT — user prompt</div>
                      <pre>{detail.userPrompt}</pre>
                    </div>
                    <div className="source-compare-col">
                      <div className="source-compare-head">③ OUTPUT — AI trả về (thô)</div>
                      <pre>{detail.output ?? '(lượt này lỗi — không có output)'}</pre>
                    </div>
                  </div>
                  {detail.errorMessage && (
                    <div className="banner banner-error" style={{ marginTop: 8 }}>
                      {detail.errorMessage}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                    {detail.model} · prompt {detail.promptScope}
                    {detail.imagePaths && detail.imagePaths.length > 0 &&
                      ` · ảnh: ${detail.imagePaths.join(', ')}`}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
