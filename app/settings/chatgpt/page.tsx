'use client';

import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';

interface AccountRow {
  id: string;
  label: string;
  connected: boolean;
  isDefault: boolean;
  hasProfile: boolean;
  lastOkAt?: string | null;
  lastError?: string | null;
}

export default function ChatgptAuthPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chatgpt-auth/accounts', { cache: 'no-store' });
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

  async function setDefault(id: string) {
    await fetch('/api/chatgpt-auth/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, isDefault: true }),
    });
    setMessage('Đã đặt làm tài khoản mặc định');
    await load();
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Xoá tài khoản "${label}"? Thư mục profile Chromium cũng bị xoá, muốn dùng lại phải đăng nhập lại từ đầu.`)) {
      return;
    }
    await fetch(`/api/chatgpt-auth/accounts?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setMessage('Đã xoá tài khoản');
    await load();
  }

  return (
    <div className="page-shell">
      <TopNav />
      <div className="home-wrap">
        <div className="card">
          <div className="card-header">🖼️ <span>Tài khoản ChatGPT (gen ảnh)</span></div>

          <div className="banner banner-info">
            Gen ảnh bằng cách điều khiển Chromium đã đăng nhập ChatGPT (không qua API trả phí).
            Thêm tài khoản bằng lệnh chạy trên <strong>máy có màn hình</strong>, không phải VPS:
            <br />
            <code>npm run chatgpt:login &quot;Tên tài khoản&quot;</code>
            <br />
            Đăng nhập xong, copy thư mục <code>data/chatgpt-profiles/&lt;id&gt;/</code> và{' '}
            <code>data/chatgpt-auth/accounts.json</code> lên VPS. Chọn model{' '}
            <strong>ChatGPT (tài khoản riêng)</strong> ở phần cấu hình gen ảnh của project/job để dùng.
          </div>

          {error && <div className="banner">⚠️ {error}</div>}
          {message && <div className="banner banner-info">{message}</div>}

          {loading ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Đang tải...</div>
          ) : accounts.length === 0 ? (
            <div className="banner">
              Chưa có tài khoản nào. Chạy <code>npm run chatgpt:login</code> trên máy có màn hình.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '8px 6px' }}>Tài khoản</th>
                  <th style={{ padding: '8px 6px' }}>Trạng thái</th>
                  <th style={{ padding: '8px 6px' }}>Gen gần nhất</th>
                  <th style={{ padding: '8px 6px' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px' }}>
                      <strong>{acc.label}</strong>
                      {acc.isDefault && <span style={{ marginLeft: 6, fontSize: 11 }}>⭐ mặc định</span>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{acc.id}</div>
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {!acc.hasProfile ? (
                        <span title="Thiếu thư mục data/chatgpt-profiles/&lt;id&gt;/ — thường do deploy sang server mới mà chưa copy profile">
                          ⚠️ thiếu profile
                        </span>
                      ) : acc.connected ? (
                        '✅ sẵn sàng'
                      ) : (
                        '❌ cần đăng nhập lại'
                      )}
                      {acc.lastError && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{acc.lastError}</div>
                      )}
                    </td>
                    <td style={{ padding: '8px 6px', fontSize: 12 }}>
                      {acc.lastOkAt ? new Date(acc.lastOkAt).toLocaleString('vi-VN') : '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {!acc.isDefault && (
                        <button type="button" className="btn" onClick={() => setDefault(acc.id)}>
                          Đặt mặc định
                        </button>
                      )}{' '}
                      <button type="button" className="btn" onClick={() => remove(acc.id, acc.label)}>
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
