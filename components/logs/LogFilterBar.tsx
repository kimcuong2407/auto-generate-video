'use client';

import { PROMPT_STEPS } from '@/lib/livestream/promptSteps';
import { SOURCE_KINDS, SOURCE_KIND_LABEL } from '@/lib/logs/sourceKind';

/** Trạng thái bộ lọc — giữ ở dạng UI, đổi sang query string ở nơi gọi. */
export interface FilterState {
  sourceKinds: string[];
  steps: string[];
  owner: string;
  model: string;
  status: 'all' | 'ok' | 'error';
  errorKind: string;
  from: string;
  to: string;
}

export const EMPTY_FILTERS: FilterState = {
  sourceKinds: [],
  steps: [],
  owner: '',
  model: '',
  status: 'all',
  errorKind: '',
  from: '',
  to: '',
};

/** Đổi bộ lọc thành query string. Bỏ hẳn ô rỗng để route phân biệt được "không lọc". */
export function filtersToQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.sourceKinds.length > 0) p.set('sourceKind', f.sourceKinds.join(','));
  if (f.steps.length > 0) p.set('step', f.steps.join(','));
  if (f.owner.trim()) p.set('owner', f.owner.trim());
  if (f.model.trim()) p.set('model', f.model.trim());
  if (f.status !== 'all') p.set('status', f.status);
  if (f.errorKind) p.set('errorKind', f.errorKind);
  if (f.from) p.set('from', f.from);
  if (f.to) p.set('to', f.to);
  return p.toString();
}

/** Có đang lọc gì không — dùng để phân biệt "không khớp bộ lọc" với "chưa có log nào". */
export function hasFilters(f: FilterState): boolean {
  return filtersToQuery(f) !== '';
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function LogFilterBar({
  value,
  onChange,
  onApply,
  onReset,
  onDelete,
  showStepFilter,
  showErrorKind,
  busy,
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onDelete: () => void;
  /** Bảng log video không có bước AI — ẩn ô này thay vì hiện một bộ lọc không tác dụng. */
  showStepFilter: boolean;
  showErrorKind: boolean;
  busy: boolean;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-header">Bộ lọc</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loại dây chuyền</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {SOURCE_KINDS.map((k) => (
              <label key={k} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={value.sourceKinds.includes(k)}
                  onChange={() => set({ sourceKinds: toggle(value.sourceKinds, k) })}
                />
                {SOURCE_KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Job slug / Project id</label>
          <input
            type="text"
            value={value.owner}
            onChange={(e) => set({ owner: e.target.value })}
            placeholder="dán id vào đây"
            style={{ display: 'block', marginTop: 4, minWidth: 220 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Model</label>
          <input
            type="text"
            value={value.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder="khớp chính xác"
            style={{ display: 'block', marginTop: 4, minWidth: 160 }}
          />
        </div>

        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Trạng thái</label>
          <select
            value={value.status}
            onChange={(e) => set({ status: e.target.value as FilterState['status'] })}
            style={{ display: 'block', marginTop: 4 }}
          >
            <option value="all">Tất cả</option>
            <option value="ok">✅ Thành công</option>
            <option value="error">❌ Lỗi</option>
          </select>
        </div>

        {showErrorKind && (
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loại lỗi</label>
            <select
              value={value.errorKind}
              onChange={(e) => set({ errorKind: e.target.value })}
              style={{ display: 'block', marginTop: 4 }}
            >
              <option value="">Tất cả</option>
              <option value="quota">Hết quota Veo</option>
              <option value="mcp">Orino MCP không kết nối</option>
              <option value="api">Lỗi API khác</option>
            </select>
          </div>
        )}

        <div>
          {/* Ngày hiểu theo giờ VN (UTC+7); server quy đổi sang UTC trước khi so với cột. */}
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Từ ngày (giờ VN)</label>
          <input
            type="date"
            value={value.from}
            onChange={(e) => set({ from: e.target.value })}
            style={{ display: 'block', marginTop: 4 }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Đến ngày (giờ VN)</label>
          <input
            type="date"
            value={value.to}
            onChange={(e) => set({ to: e.target.value })}
            style={{ display: 'block', marginTop: 4 }}
          />
        </div>
      </div>

      {showStepFilter && (
        <div style={{ marginTop: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bước AI</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
            {PROMPT_STEPS.map((s) => (
              <label key={s.key} style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={value.steps.includes(s.key)}
                  onChange={() => set({ steps: toggle(value.steps, s.key) })}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={onApply} disabled={busy}>
          {busy ? 'Đang tải...' : '🔍 Lọc'}
        </button>
        <button className="btn" onClick={onReset} disabled={busy}>
          Xoá bộ lọc
        </button>
        <button
          className="btn"
          onClick={onDelete}
          disabled={busy || !hasFilters(value)}
          // Không có bộ lọc thì không có gì để xoá an toàn — server cũng từ chối, nhưng chặn ngay ở
          // đây để Mr.D không bấm rồi mới thấy lỗi.
          title={hasFilters(value) ? 'Xoá vĩnh viễn các dòng khớp bộ lọc' : 'Chọn bộ lọc trước khi xoá'}
          style={{ marginLeft: 'auto', color: 'var(--red, #d33)' }}
        >
          🗑 Xoá theo bộ lọc
        </button>
      </div>
    </div>
  );
}
