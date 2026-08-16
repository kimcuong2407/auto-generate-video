'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { LivestreamChaining } from '@/lib/livestream/types';
import type { VeoModel } from '@/lib/types';

const MODEL_OPTIONS: { value: VeoModel; label: string }[] = [
  { value: 'veo_3_1_fast', label: 'Veo 3.1 Fast' },
  { value: 'veo_3_1_quality', label: 'Veo 3.1 Quality' },
  { value: 'veo_3_1_lite', label: 'Veo 3.1 Lite' },
  { value: 'veo_3_1_lite_low_priority', label: 'Veo 3.1 Lite (Low priority)' },
  { value: 'abra', label: 'Abra (Omni Flash)' },
];

type EntryType = 'link' | 'file' | 'manual';

interface EntryFormState {
  key: string;
  type: EntryType;
  link: string;
  text: string;
  files: File[];
  targetDurationMin: string; // nhập theo phút cho dễ, quy đổi ra giây khi submit
}

let entryKeyCounter = 0;
function newEntry(): EntryFormState {
  entryKeyCounter += 1;
  return { key: `entry-${entryKeyCounter}`, type: 'link', link: '', text: '', files: [], targetDurationMin: '1' };
}

/** Kiểm tra file có phải ảnh (để chỉ preview ảnh, không preview .txt/.csv). */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Thumbnail 1 file đã chọn (ảnh preview qua object URL, file text hiện tên) + nút xoá. */
function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImageFile(file)) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div style={{ position: 'relative', width: 64, height: 64 }}>
      {url ? (
        <img
          src={url}
          alt={file.name}
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      ) : (
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 8,
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            padding: 4,
            textAlign: 'center',
            wordBreak: 'break-all',
            color: 'var(--text-muted)',
          }}
        >
          📄 {file.name.slice(0, 18)}
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Xoá file này"
        style={{
          position: 'absolute',
          top: -6,
          right: -6,
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: 'none',
          background: 'var(--surface2)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: '20px',
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}

export function CreateJobForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '16:9'>('9:16');
  const [veoModel, setVeoModel] = useState<VeoModel>('veo_3_1_fast');
  const [chaining, setChaining] = useState<LivestreamChaining>('continuous');
  const [entries, setEntries] = useState<EntryFormState[]>([newEntry()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function updateEntry(key: string, patch: Partial<EntryFormState>) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function removeEntry(key: string) {
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e.key !== key) : prev));
  }

  async function handleSubmit() {
    setError(null);
    setWarnings([]);
    if (!name.trim()) {
      setError('Cần nhập tên job');
      return;
    }

    const form = new FormData();
    form.set('name', name.trim());
    form.set('aspectRatio', aspectRatio);
    form.set('veoModel', veoModel);
    form.set('chaining', chaining);

    const entriesMeta: Array<{ type: EntryType; link?: string; text?: string; fileField?: string; targetDurationSec: number }> = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const targetDurationSec = Math.max(1, Math.round((Number(entry.targetDurationMin) || 0) * 60));
      if (entry.type === 'link') {
        if (!entry.link.trim()) {
          setError(`Sản phẩm #${i + 1}: thiếu link`);
          return;
        }
        entriesMeta.push({ type: 'link', link: entry.link.trim(), targetDurationSec });
      } else if (entry.type === 'manual') {
        if (!entry.text.trim()) {
          setError(`Sản phẩm #${i + 1}: thiếu mô tả`);
          return;
        }
        entriesMeta.push({ type: 'manual', text: entry.text.trim(), targetDurationSec });
      } else {
        if (entry.files.length === 0) {
          setError(`Sản phẩm #${i + 1}: thiếu file`);
          return;
        }
        const fileField = `entryFile_${i}`;
        // Gửi nhiều file cùng field name — server đọc bằng form.getAll(fileField).
        for (const f of entry.files) {
          form.append(fileField, f);
        }
        entriesMeta.push({ type: 'file', fileField, targetDurationSec });
      }
    }
    form.set('entries', JSON.stringify(entriesMeta));

    setSubmitting(true);
    try {
      const res = await fetch('/api/livestream', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Tạo job thất bại');
        setWarnings(data.warnings || []);
        return;
      }
      if (data.warnings?.length) {
        setWarnings(data.warnings);
      }
      router.push(`/livestream/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        📡 <span>Tạo job Livestream Script mới</span>
      </div>

      <div className="step-actions">
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Đang tạo...' : '→ Tạo job'}
        </button>
      </div>

      <div className="banner banner-info">
        Với mỗi sản phẩm: chọn 1 trong 3 nguồn (link / file ảnh-text-csv / nhập tay), kèm thời lượng thoại mong
        muốn. Nếu link bị chặn (VD Shopee) hoặc file là ảnh, hệ thống sẽ đánh dấu &quot;cần bổ sung thủ công&quot; —
        bạn có thể dán mô tả trực tiếp ở trang chi tiết job. File .txt/.csv chứa nhiều sản phẩm: phân cách mỗi sản
        phẩm bằng dòng &quot;---&quot; hoặc 2 dòng trống liên tiếp.
      </div>

      <div className="field-group">
        <label>Tên job</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Live tối thứ 7" />
      </div>

      <div className="field-group">
        <label>Tỷ lệ khung hình</label>
        <div className="toggle-group">
          <button className={`toggle-btn ${aspectRatio === '9:16' ? 'active' : ''}`} onClick={() => setAspectRatio('9:16')}>
            9:16 (dọc)
          </button>
          <button className={`toggle-btn ${aspectRatio === '16:9' ? 'active' : ''}`} onClick={() => setAspectRatio('16:9')}>
            16:9 (ngang)
          </button>
        </div>
      </div>

      <div className="field-group">
        <label>Model Veo</label>
        <select
          value={veoModel}
          onChange={(e) => setVeoModel(e.target.value as VeoModel)}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 7,
            color: 'var(--text)',
            fontSize: 13,
            padding: '8px 12px',
          }}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field-group">
        <label>Chaining (chain khung hình cuối → đầu giữa các đoạn)</label>
        <div className="toggle-group">
          <button className={`toggle-btn ${chaining === 'continuous' ? 'active' : ''}`} onClick={() => setChaining('continuous')}>
            Liên tục (xuyên suốt mọi sản phẩm)
          </button>
          <button className={`toggle-btn ${chaining === 'per_product' ? 'active' : ''}`} onClick={() => setChaining('per_product')}>
            Theo từng sản phẩm
          </button>
          <button className={`toggle-btn ${chaining === 'off' ? 'active' : ''}`} onClick={() => setChaining('off')}>
            Tắt
          </button>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          &quot;Liên tục&quot; cho cảm giác 1 buổi live không cắt cảnh — phù hợp nhất với livestream, nhưng buộc sinh
          video tuần tự (chậm hơn). &quot;Tắt&quot; cho phép sinh song song, nhanh hơn nhưng các đoạn độc lập.
        </span>
      </div>

      <div className="field-group">
        <label>Danh sách sản phẩm</label>
        <div className="scene-list">
          {entries.map((entry, i) => (
            <div key={entry.key} className="script-edit-row">
              <div className="row-fields">
                <select
                  value={entry.type}
                  onChange={(e) => updateEntry(entry.key, { type: e.target.value as EntryType })}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: 6 }}
                >
                  <option value="link">Link sản phẩm</option>
                  <option value="file">File (ảnh/.txt/.csv)</option>
                  <option value="manual">Nhập tay</option>
                </select>
                <input
                  type="text"
                  placeholder="Thời lượng (phút)"
                  value={entry.targetDurationMin}
                  onChange={(e) => updateEntry(entry.key, { targetDurationMin: e.target.value })}
                />
                <button className="scene-remove-btn" onClick={() => removeEntry(entry.key)} disabled={entries.length <= 1} title="Xoá sản phẩm này">
                  ✕
                </button>
              </div>

              {entry.type === 'link' && (
                <>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={entry.link}
                    onChange={(e) => updateEntry(entry.key, { link: e.target.value })}
                  />
                  {/shopee\./i.test(entry.link) && (
                    <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                      ⚠️ Shopee thường chặn tự động đọc — có thể cần dán ảnh chụp màn hình sản phẩm ở trang chi
                      tiết sau khi tạo job.
                    </span>
                  )}
                </>
              )}
              {entry.type === 'manual' && (
                <textarea
                  rows={3}
                  placeholder="Dán mô tả sản phẩm (có thể nhiều sản phẩm, phân cách bằng --- hoặc 2 dòng trống)"
                  value={entry.text}
                  onChange={(e) => updateEntry(entry.key, { text: e.target.value })}
                />
              )}
              {entry.type === 'file' && (
                <>
                  <input
                    type="file"
                    accept="image/*,.txt,.csv"
                    multiple
                    onChange={(e) => {
                      const picked = e.target.files ? Array.from(e.target.files) : [];
                      // Append vào danh sách đã chọn để có thể chọn nhiều lần; giữ trùng lặp tối thiểu
                      // bằng cách lọc theo name+size.
                      updateEntry(entry.key, {
                        files: [
                          ...entry.files,
                          ...picked.filter(
                            (p) => !entry.files.some((f) => f.name === p.name && f.size === p.size)
                          ),
                        ],
                      });
                      e.target.value = '';
                    }}
                  />
                  {entry.files.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {entry.files.map((f, fi) => (
                        <FilePreview
                          key={`${f.name}-${f.size}-${fi}`}
                          file={f}
                          onRemove={() =>
                            updateEntry(entry.key, {
                              files: entry.files.filter((_, idx) => idx !== fi),
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Ảnh đầu tiên dùng để AI đọc mô tả; tất cả ảnh được lưu làm ảnh tham chiếu khi gen video.
                  </span>
                </>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sản phẩm #{i + 1}</span>
            </div>
          ))}
        </div>
        <button className="btn add-scene-btn" onClick={() => setEntries((prev) => [...prev, newEntry()])}>
          + Thêm sản phẩm
        </button>
      </div>

      {error && <div className="banner">{error}</div>}
      {warnings.length > 0 && (
        <div className="banner banner-info">
          {warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
