'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';

interface AccountRow {
  id: string;
  label: string;
  hasCookie: boolean;
  hasAccessToken: boolean;
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
  const [accessToken, setAccessToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
  }, [load]);

  function openAdd() {
    setEditId(null);
    setLabel('');
    setCookie('');
    setAccessToken('');
    setMessage(null);
    setShowForm(true);
  }

  function openEdit(acc: AccountRow) {
    setEditId(acc.id);
    setLabel(acc.label);
    setCookie('');
    setAccessToken('');
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
          accessToken: accessToken || null,
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
                  <th style={{ padding: '8px 6px' }}>Access token</th>
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
                    <td style={{ padding: '8px 6px' }}>{acc.hasAccessToken ? '✅' : '—'}</td>
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
              <div className="field-group">
                <label>Access token (access_token từ /fx/api/auth/session)</label>
                <textarea
                  rows={2}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Có thể để trống — app tự refresh."
                />
              </div>
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
