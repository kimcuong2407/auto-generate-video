'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import { AiRunDetail, type AiRunDetailData } from '@/components/logs/AiRunDetail';
import {
  EMPTY_FILTERS,
  LogFilterBar,
  filtersToQuery,
  hasFilters,
  type FilterState,
} from '@/components/logs/LogFilterBar';
import { fullTimeVn } from '@/lib/format/datetime';
import { SOURCE_KIND_LABEL } from '@/lib/logs/sourceKind';
import { PROMPT_STEPS } from '@/lib/livestream/promptSteps';

/**
 * Tab log tập trung: mọi lượt gọi AI và mọi lượt gen video, lọc + sắp theo thời gian.
 *
 * Hai bảng đứng riêng (2 tab con) chứ không trộn: chúng có tập cột gần như rời nhau và hai trục
 * phân trang độc lập — xem doc-comment app/api/logs/flow/route.ts.
 *
 * Mọi thời gian hiển thị theo UTC+7 (lib/format/datetime.ts), không theo múi giờ máy: VPS chạy UTC
 * nên nếu không ép, cùng một dòng log hiện hai giờ khác nhau tuỳ mở ở đâu.
 */

const STEP_LABEL = new Map(PROMPT_STEPS.map((s) => [s.key as string, s.label]));

type Tab = 'ai' | 'flow';

interface AiRow {
  rowId: number;
  createdAt: string;
  sourceKind: string;
  stepKey: string;
  jobSlug: string;
  projectId: string;
  productId: string;
  model: string;
  durationMs: number;
  attempts: number;
  imageCount: number;
  outputLength: number;
  ok: boolean;
}

interface FlowRow {
  rowId: number;
  createdAt: string;
  sourceKind: string;
  jobSlug: string;
  projectId: string;
  unitId: string;
  unitOrder: number;
  flowJobId: string;
  model: string;
  aspect: string;
  durationSec: number;
  chained: boolean;
  errorKind: string;
  attempts: number;
  durationMs: number;
  promptLength: number;
  ok: boolean;
}

interface FlowDetail extends FlowRow {
  veoPrompt: string;
  promptIsRaw: boolean;
  voiceoverVi: string | null;
  negativePrompt: string | null;
  refImagePaths: string[] | null;
  startImagePath: string;
  errorMessage: string | null;
  flowProjectId: string;
}

interface SizeInfo {
  tables: { name: string; rows: number; bytes: number }[];
  estimated: boolean;
}

const owner = (r: { jobSlug: string; projectId: string }) => r.jobSlug || r.projectId || '—';
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>('ai');
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  /** Bộ lọc ĐÃ áp dụng — tách khỏi `draft` để sửa ô không tự bắn request mỗi lần gõ. */
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);

  const [rows, setRows] = useState<(AiRow | FlowRow)[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [detail, setDetail] = useState<AiRunDetailData | FlowDetail | null>(null);
  const [size, setSize] = useState<SizeInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSize = useCallback(async () => {
    try {
      const res = await fetch('/api/logs/size', { cache: 'no-store' });
      if (res.ok) setSize(await res.json());
    } catch {
      // Khối dung lượng chỉ là thông tin phụ — hỏng thì ẩn đi, không chặn xem log.
    }
  }, []);

  const load = useCallback(
    async (f: FilterState, cursor: number | null) => {
      setBusy(true);
      setError(null);
      try {
        const qs = filtersToQuery(f);
        const url = `/api/logs/${tab}?${qs}${cursor ? `${qs ? '&' : ''}cursor=${cursor}` : ''}`;
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        // cursor != null = đang "tải thêm" → nối vào, không thay cả danh sách.
        setRows((prev) => (cursor ? [...prev, ...data.runs] : data.runs));
        setNextCursor(data.nextCursor ?? null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [tab]
  );

  // Đổi tab = danh sách khác hẳn → dọn sạch trạng thái cũ, không để sót dòng đang mở của tab kia.
  useEffect(() => {
    setRows([]);
    setNextCursor(null);
    setOpenRow(null);
    setDetail(null);
    void load(applied, null);
    void loadSize();
    // `applied` cố ý KHÔNG nằm trong deps: nó chỉ đổi khi bấm Lọc, và lúc đó handler tự gọi load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function openDetail(rowId: number) {
    if (openRow === rowId) {
      setOpenRow(null);
      setDetail(null);
      return;
    }
    setOpenRow(rowId);
    setDetail(null);
    try {
      const res = await fetch(`/api/logs/${tab}?id=${rowId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(data.run);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function applyFilters() {
    setApplied(draft);
    setOpenRow(null);
    setDetail(null);
    void load(draft, null);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOpenRow(null);
    setDetail(null);
    void load(EMPTY_FILTERS, null);
  }

  /**
   * Xoá theo bộ lọc: đếm thử trước rồi bắt gõ đúng chữ XOA.
   *
   * Đếm trước là phần quan trọng nhất — xác nhận mà không biết mình xoá bao nhiêu dòng thì không
   * phải là xác nhận. Server còn từ chối lần nữa nếu bộ lọc rỗng (xem /api/logs/delete).
   */
  async function deleteByFilter() {
    if (!hasFilters(draft)) return;
    setBusy(true);
    setError(null);
    try {
      const qs = filtersToQuery(draft);
      const res = await fetch(`/api/logs/delete?table=${tab}&dryRun=1&${qs}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const count = Number(data.count ?? 0);
      if (count === 0) {
        setError('Không có dòng nào khớp bộ lọc — không xoá gì.');
        return;
      }
      const typed = window.prompt(
        `Sẽ xoá ${count} dòng khớp bộ lọc hiện tại. KHÔNG khôi phục được.\n\n` +
          `Gõ XOA để xác nhận:`
      );
      if (typed !== 'XOA') {
        setError('Đã huỷ — chưa xoá gì.');
        return;
      }
      const del = await fetch(`/api/logs/delete?table=${tab}&${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'XOA' }),
      });
      const delData = await del.json();
      if (!del.ok) throw new Error(delData.error || `HTTP ${del.status}`);
      setError(`Đã xoá ${delData.deleted} dòng.`);
      setOpenRow(null);
      setDetail(null);
      await load(applied, null);
      await loadSize();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isAi = tab === 'ai';

  return (
    <div className="page-shell">
      <TopNav />
      <div className="list-wrap">
        <div className="page-header">
          <div className="card-header" style={{ marginBottom: 0 }}>
            🗂️ Log AI &amp; Video
          </div>
        </div>

        {size && size.tables.length > 0 && (
          <div className="card">
            <div className="card-header">Dung lượng log</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8 }}>
              {size.tables.map((t) => (
                <div key={t.name}>
                  <code>{t.name}</code>: ~{t.rows.toLocaleString('vi-VN')} dòng · {mb(t.bytes)} MB
                </div>
              ))}
              <div style={{ marginTop: 6 }}>
                Log được giữ <strong>vĩnh viễn</strong> (không tự cắt tỉa) — số dòng là ước lượng của
                InnoDB nên có thể lệch. Dọn bằng nút &quot;Xoá theo bộ lọc&quot; bên dưới.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className={`btn ${isAi ? 'btn-primary' : ''}`} onClick={() => setTab('ai')}>
            🤖 Log gọi AI
          </button>
          <button className={`btn ${!isAi ? 'btn-primary' : ''}`} onClick={() => setTab('flow')}>
            🎬 Log gen video Veo
          </button>
        </div>

        <LogFilterBar
          value={draft}
          onChange={setDraft}
          onApply={applyFilters}
          onReset={resetFilters}
          onDelete={deleteByFilter}
          showStepFilter={isAi}
          showErrorKind={!isAi}
          busy={busy}
        />

        {error && (
          <div className="banner" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-header">
            {rows.length > 0 ? `Đang xem ${rows.length} dòng` : 'Kết quả'}
          </div>

          {rows.length === 0 && !busy && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {/* Phân biệt rõ 2 ca: lọc không ra gì KHÁC với chưa có log nào — gộp lại thì Mr.D
                  tưởng hệ thống hỏng. */}
              {hasFilters(applied)
                ? 'Không có log nào khớp bộ lọc.'
                : 'Chưa có log nào. Chạy thử một bước AI hoặc gen 1 cảnh video rồi quay lại.'}
            </div>
          )}

          {rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Thời gian (UTC+7)</th>
                    <th style={{ padding: '6px 8px' }}>Loại</th>
                    <th style={{ padding: '6px 8px' }}>{isAi ? 'Bước' : 'Cảnh'}</th>
                    <th style={{ padding: '6px 8px' }}>Job / Project</th>
                    <th style={{ padding: '6px 8px' }}>Model</th>
                    <th style={{ padding: '6px 8px' }}>Thời lượng</th>
                    <th style={{ padding: '6px 8px' }}>Thử</th>
                    <th style={{ padding: '6px 8px' }}>KQ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ai = r as AiRow;
                    const fl = r as FlowRow;
                    return (
                      <tr
                        key={r.rowId}
                        onClick={() => void openDetail(r.rowId)}
                        style={{
                          borderTop: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: openRow === r.rowId ? 'var(--bg-hover, rgba(127,127,127,.08))' : undefined,
                        }}
                      >
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{fullTimeVn(r.createdAt)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {SOURCE_KIND_LABEL[r.sourceKind] ?? r.sourceKind}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {isAi
                            ? STEP_LABEL.get(ai.stepKey) ?? ai.stepKey
                            : `#${fl.unitOrder}${fl.chained ? ' (nối cảnh)' : ''}`}
                        </td>
                        <td style={{ padding: '6px 8px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {owner(r)}
                        </td>
                        <td style={{ padding: '6px 8px' }}>{r.model}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {(r.durationMs / 1000).toFixed(1)}s
                        </td>
                        <td style={{ padding: '6px 8px' }}>{r.attempts}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          {r.ok ? '✅' : `❌${!isAi && fl.errorKind ? ` ${fl.errorKind}` : ''}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {openRow !== null && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {!detail && <div style={{ fontSize: 12, opacity: 0.7 }}>Đang tải nội dung...</div>}
              {detail && isAi && <AiRunDetail detail={detail as AiRunDetailData} />}
              {detail && !isAi && <FlowDetailView detail={detail as FlowDetail} />}
            </div>
          )}

          {nextCursor && (
            <button className="btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void load(applied, nextCursor)}>
              {busy ? 'Đang tải...' : 'Tải thêm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Chi tiết 1 lượt gen video — cột khác hẳn lượt gọi AI nên không dùng chung AiRunDetail được. */
function FlowDetailView({ detail }: { detail: FlowDetail }) {
  return (
    <>
      <div className="source-compare">
        <div className="source-compare-col">
          <div className="source-compare-head">
            ① PROMPT VEO {detail.promptIsRaw ? '(bản THÔ — lượt này hỏng trước khi ghép xong)' : '(đúng bản đã gửi)'}
          </div>
          <pre>{detail.veoPrompt}</pre>
        </div>
        <div className="source-compare-col">
          <div className="source-compare-head">② LỜI THOẠI</div>
          <pre>{detail.voiceoverVi || '(không có)'}</pre>
        </div>
        <div className="source-compare-col">
          <div className="source-compare-head">③ NEGATIVE PROMPT</div>
          <pre>{detail.negativePrompt || '(không có)'}</pre>
        </div>
      </div>

      {detail.errorMessage && (
        <div className="banner banner-error" style={{ marginTop: 8 }}>
          [{detail.errorKind || 'lỗi'}] {detail.errorMessage}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.7 }}>
        <div>
          {detail.model} · {detail.aspect} · {detail.durationSec}s · gửi mất{' '}
          {(detail.durationMs / 1000).toFixed(1)}s · lần thử thứ {detail.attempts}
        </div>
        <div>
          Flow job: <code>{detail.flowJobId || '(chưa gửi được)'}</code> · Flow project:{' '}
          <code>{detail.flowProjectId || '—'}</code>
        </div>
        {detail.startImagePath && (
          <div>
            Khung khởi điểm: <code>{detail.startImagePath}</code>
            {detail.chained ? ' (frame cuối cảnh trước)' : ''}
          </div>
        )}
        {detail.refImagePaths && detail.refImagePaths.length > 0 && (
          <div>Ảnh tham chiếu: {detail.refImagePaths.join(', ')}</div>
        )}
      </div>
    </>
  );
}
