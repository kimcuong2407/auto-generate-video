'use client';

import { useCallback, useState } from 'react';

/**
 * Mục thu gọn "Lượt chạy gần nhất": hiện INPUT/OUTPUT THẬT của các lượt gọi AI ở một bước.
 *
 * Vì sao cần: ô sửa prompt phía trên hiện bản CÒN NGUYÊN `${ten_sanpham}`, còn thứ AI thật sự nhận
 * là bản đã thay giá trị, ghép thêm khối sân khấu/khoá sản phẩm, kèm ảnh. Không nhìn được chuỗi đã
 * gửi thì sửa prompt là đoán mò; và với các bước không lưu kết quả (rút gọn lời thoại, kiểm duyệt,
 * chuẩn hoá mô tả) thì chạy xong là mất sạch dấu vết.
 *
 * LAZY LOAD hai tầng — mở mục mới gọi API, chọn lượt mới tải nội dung lượt đó: 1 lượt sinh script
 * ~60k ký tự (system + user + output), nhân 20 lượt × 11 bước là vài MB. Tải sẵn hết lúc mở panel
 * sẽ treo tab.
 */

/** Bước không có lượt gọi AI text để log — giải thích thay vì hiện mục rỗng cho Mr.D tưởng lỗi. */
const NO_RUN_LOG: Record<string, string> = {
  background:
    'Bước này sinh ra ẢNH chứ không phải text nên không có input/output dạng chữ để đối chiếu. Xem prompt thật ở nút 👁 phía trên; ảnh kết quả nằm ở panel ảnh của job.',
  negative_video:
    'Bước này không phải một lượt gọi AI riêng — nội dung ở trên được ghép vào câu lệnh gửi Veo mỗi lần gen video. Xem câu lệnh thật ở nút 👁 của từng đoạn.',
};

interface RunMeta {
  rowId: number;
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

const SCOPE_LABEL: Record<string, string> = {
  job: 'riêng job này',
  global: 'mặc định đã tuỳ chỉnh',
  default: 'mặc định hệ thống',
};

/** "2026-09-03 14:32:07.123" → "14:32:07 03/09". Dữ liệu từ DB nên định dạng cố định, cắt là đủ. */
function shortTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${m[4]} ${m[3]}/${m[2]}` : iso;
}

export function AiCallLogView({ stepKey, jobSlug }: { stepKey: string; jobSlug?: string }) {
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const note = NO_RUN_LOG[stepKey];

  const query = useCallback(
    (extra = '') =>
      `/api/ai-logs?step=${encodeURIComponent(stepKey)}&jobSlug=${encodeURIComponent(jobSlug ?? '')}${extra}`,
    [stepKey, jobSlug]
  );

  const loadDetail = useCallback(
    async (rowId: number) => {
      setLoading(true);
      try {
        const res = await fetch(query(`&id=${rowId}`));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setDetail(data.run);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [query]
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(query());
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRuns(data.runs);
      setError(null);
      // Mở mục ra là thấy ngay lượt gần nhất, không phải bấm thêm một nhịp nữa.
      if (data.runs.length > 0) await loadDetail(data.runs[0].rowId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, loadDetail]);

  if (note) {
    return (
      <div className="banner banner-info" style={{ marginTop: 8, fontSize: 12 }}>
        {note}
      </div>
    );
  }

  return (
    <details
      style={{ marginTop: 8 }}
      onToggle={(e) => {
        // Chỉ nạp ở lần mở ĐẦU TIÊN — mở/đóng lại không gọi API thêm.
        if ((e.currentTarget as HTMLDetailsElement).open && runs === null && !loading) void loadList();
      }}
    >
      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
        🔍 Lượt chạy gần nhất — input/output thật đã gửi cho AI
      </summary>

      {loading && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>Đang tải...</div>}
      {error && <div className="banner banner-error" style={{ marginTop: 6 }}>{error}</div>}

      {runs?.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Bước này chưa chạy lần nào{jobSlug ? ' trong job này' : ''}.
        </div>
      )}

      {runs && runs.length > 0 && (
        <>
          <select
            value={detail?.rowId ?? runs[0].rowId}
            onChange={(e) => void loadDetail(Number(e.target.value))}
            style={{ width: '100%', marginTop: 8, fontSize: 12 }}
          >
            {runs.map((r, i) => (
              <option key={r.rowId} value={r.rowId}>
                {i === 0 ? '● mới nhất' : `${i + 1}.`} {shortTime(r.createdAt)} ·{' '}
                {(r.durationMs / 1000).toFixed(1)}s
                {r.attempts > 1 ? ` · ${r.attempts} lần thử` : ''}
                {r.productId ? ` · sp ${r.productId.slice(0, 8)}` : ''} {r.ok ? '✅' : '❌ lỗi'}
              </option>
            ))}
          </select>

          {detail && (
            <>
              <div className="source-compare">
                <div className="source-compare-col">
                  {/* Điểm giá trị nhất: ô sửa phía trên còn nguyên ${params}, đây là bản AI thật sự nhận. */}
                  <div className="source-compare-head">① INPUT — system prompt (đã ghép ${'${params}'})</div>
                  <pre>{detail.systemPrompt}</pre>
                </div>
                <div className="source-compare-col">
                  <div className="source-compare-head">② INPUT — user prompt (dữ liệu sản phẩm)</div>
                  <pre>{detail.userPrompt}</pre>
                </div>
                <div className="source-compare-col">
                  <div className="source-compare-head">③ OUTPUT — AI trả về (thô, chưa parse)</div>
                  <pre>{detail.output ?? '(lượt này lỗi — không có output)'}</pre>
                </div>
              </div>

              {detail.errorMessage && (
                <div className="banner banner-error" style={{ marginTop: 8 }}>
                  {detail.errorMessage}
                </div>
              )}

              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                {detail.model} · {(detail.durationMs / 1000).toFixed(1)}s · {detail.attempts} lần thử ·
                prompt {SCOPE_LABEL[detail.promptScope] ?? detail.promptScope}
                {detail.imageCount > 0 && ` · ${detail.imageCount} ảnh đính kèm`}
                {detail.imagePaths && detail.imagePaths.length > 0 && `: ${detail.imagePaths.join(', ')}`}
              </div>
            </>
          )}
        </>
      )}
    </details>
  );
}
