'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';
import type { VeoModel } from '@/lib/types';

const MODEL_LABELS: Record<VeoModel, string> = {
  veo_3_1_fast: 'Veo 3.1 Fast',
  veo_3_1_quality: 'Veo 3.1 Quality',
  veo_3_1_lite: 'Veo 3.1 Lite',
  veo_3_1_lite_low_priority: 'Veo 3.1 Lite (Lower Priority)',
  abra: 'Omni Flash (Abra)',
};

interface AccountRow {
  id: string;
  label: string;
  hasCookie: boolean;
  hasAccessToken: boolean;
  hasAt: boolean;
  bl: string | null;
  isDefault: boolean;
  recaptchaImage: boolean;
  recaptchaVideo: boolean;
}

export default function FlowAuthPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form thêm/sửa
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [cookie, setCookie] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Model Veo dùng chung cho mọi luồng gen ('' = theo cấu hình từng project/job).
  const [veoModel, setVeoModel] = useState<VeoModel | ''>('');
  const [modelOptions, setModelOptions] = useState<VeoModel[]>([]);
  const [savingModel, setSavingModel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/flow-auth/status', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAccounts(data.accounts || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    fetch('/api/flow-settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setVeoModel(d.veoModel || '');
        setModelOptions(d.options || []);
      })
      .catch(() => {});
  }, [load]);

  async function handleSaveModel(next: VeoModel | '') {
    setVeoModel(next);
    setSavingModel(true);
    setMessage(null);
    try {
      const res = await fetch('/api/flow-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ veoModel: next || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lưu thất bại');
      setMessage(next ? `Đã áp dụng ${MODEL_LABELS[next]} cho mọi luồng gen video` : 'Đã bỏ ép model — theo cấu hình từng project/job');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSavingModel(false);
    }
  }

  function openAdd() {
    setEditId(null);
    setLabel('');
    setCookie('');
    setMessage(null);
    setShowForm(true);
  }

  function openEdit(acc: AccountRow) {
    setEditId(acc.id);
    setLabel(acc.label);
    setCookie('');
    setMessage(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!label.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/flow-auth/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editId || undefined,
          label,
          cookie: cookie || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lưu thất bại');
      setShowForm(false);
      await load();
      setMessage('Đã lưu tài khoản');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    await fetch('/api/flow-auth/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Xoá tài khoản này?')) return;
    await fetch('/api/flow-auth/accounts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await load();
  }

  return (
    <div className="page-shell">
      <TopNav />
      <div className="home-wrap">
        <div className="card">
          <div className="card-header">🎬 <span>Model gen video (áp dụng cho tất cả)</span></div>

          <div className="banner banner-info">
            Model chọn ở đây đè lên cấu hình model của TỪNG project review và TỪNG job livestream.
            Chọn &quot;Theo từng project/job&quot; để quay lại hành vi cũ.
          </div>

          <div className="field-group">
            <label>Model Veo</label>
            <select
              value={veoModel}
              disabled={savingModel}
              onChange={(e) => handleSaveModel(e.target.value as VeoModel | '')}
            >
              <option value="">Theo từng project/job (không ép)</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m] || m}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-header">🔑 <span>Quản lý tài khoản Veo / Google Flow</span></div>

          <div className="banner banner-info">
            App gọi trực tiếp Google Flow API (không qua Orino Flow). Cần cookie + access_token từ phiên
            <code>labs.google</code> đã đăng nhập, và reCAPTCHA token do Chrome extension
            <code>extension-flow</code> mint (tự refresh ~90s).
          </div>

          {error && <div className="banner">⚠️ {error}</div>}
          {message && <div className="banner banner-info">{message}</div>}

          <div style={{ marginBottom: 16 }}>
            <button type="button" className="btn btn-primary" onClick={openAdd} disabled={loading}>
              + Thêm tài khoản
            </button>
          </div>

          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Đang tải...</div>
          ) : accounts.length === 0 ? (
            <div className="banner">Chưa có tài khoản nào. Bấm &quot;Thêm tài khoản&quot; hoặc load extension.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 6px' }}>Tài khoản</th>
                  <th style={{ padding: '8px 6px' }}>Cookie</th>
                  <th style={{ padding: '8px 6px' }}>at token</th>
                  <th style={{ padding: '8px 6px' }}>Build (bl)</th>
                  <th style={{ padding: '8px 6px' }}>reCAPTCHA</th>
                  <th style={{ padding: '8px 6px' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px' }}>
                      <strong>{acc.label}</strong>{' '}
                      {acc.isDefault && <span className="badge badge-done">Mặc định</span>}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{acc.hasCookie ? '✅' : '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{acc.hasAt ? '✅' : '—'}</td>
                    <td style={{ padding: '8px 6px', fontSize: 11, opacity: 0.75 }}>
                      {acc.bl ? acc.bl.replace('boq_labs-ai-sandbox-frontend_', '') : '—'}
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: 12 }}>
                      <span title="IMAGE_GENERATION">{acc.recaptchaImage ? '🖼️' : '○'}</span>{' '}
                      <span title="VIDEO_GENERATION">{acc.recaptchaVideo ? '🎥' : '○'}</span>
                    </td>
                    <td style={{ padding: '8px 6px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!acc.isDefault && (
                        <button type="button" className="btn" onClick={() => handleSetDefault(acc.id)}>
                          Đặt mặc định
                        </button>
                      )}
                      <button type="button" className="btn" onClick={() => openEdit(acc)}>
                        Sửa
                      </button>
                      <button type="button" className="btn btn-danger" onClick={() => handleDelete(acc.id)}>
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {showForm && (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div className="card-header">{editId ? 'Sửa tài khoản' : 'Thêm tài khoản'}</div>
              <div className="field-group">
                <label>Nhãn (tên hiển thị)</label>
                <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="field-group">
                <label>Cookie (full Cookie header của labs.google)</label>
                <textarea
                  rows={3}
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="Dán full cookie. Để trống nếu chỉ cập nhật nhãn."
                />
              </div>
              {/*
                Ô nhập access_token cũ đã bỏ: Google gỡ /fx/api/auth/session (2026-09).
                Thay thế là `at` token, gắn với phiên và đổi mỗi lần load trang — không có
                cách nào dán tay cho đúng, bắt buộc lấy qua extension.
              */}
              <p style={{ fontSize: 12, opacity: 0.75, margin: 0 }}>
                <strong>at token</strong> không nhập tay được (gắn với phiên, đổi mỗi lần load trang).
                Mở tab <code>flow.google.com</code> đã đăng nhập rồi bấm gửi session ở popup extension.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Đang lưu...' : '💾 Lưu'}
                </button>
                <button type="button" className="btn" onClick={() => setShowForm(false)} disabled={saving}>
                  Huỷ
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
