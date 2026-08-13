'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface RouterModelOption {
  id: string;
  ownedBy: string | null;
}

export default function AiSettingsPage() {
  const [models, setModels] = useState<RouterModelOption[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);

  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [chatModel, setChatModel] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [loadingSettings, setLoadingSettings] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  async function loadModels() {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/ai-settings/models');
      const data = await res.json();
      if (!res.ok) {
        setModelsError(data.error || 'Không lấy được danh sách model');
        setModels([]);
        return;
      }
      setModels(data.models || []);
    } catch (err) {
      setModelsError((err as Error).message);
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  }

  async function loadSettings() {
    setLoadingSettings(true);
    try {
      const res = await fetch('/api/ai-settings');
      const data = await res.json();
      setDefaultModel(data.defaultModel || null);
      setChatModel(data.chatModel || null);
      setSelected(data.chatModel || '');
    } finally {
      setLoadingSettings(false);
    }
  }

  useEffect(() => {
    loadModels();
    loadSettings();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatModel: selected || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Lưu cấu hình thất bại');
        return;
      }
      setChatModel(data.chatModel || null);
      setSaveOk(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSelected('');
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatModel: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Reset thất bại');
        return;
      }
      setChatModel(null);
      setSaveOk(true);
    } finally {
      setSaving(false);
    }
  }

  const effectiveModel = chatModel || defaultModel;

  return (
    <div className="home-wrap">
      <div className="logo" style={{ marginBottom: 24 }}>
        🎬 <span>Veo</span> Pipeline
      </div>

      <div className="card">
        <div className="card-header">
          ⚙️ <span>Cài đặt AI — Model sinh kịch bản (9router)</span>
        </div>

        <div className="banner banner-info">
          Model dùng để gọi <strong>AI_CHAT_API_URL</strong> (9router: <code>ai-api.jyoohome.com</code>) khi bấm
          &quot;Sinh nháp bằng AI&quot; ở Bước 2. Áp dụng chung cho mọi project. Không chọn gì = dùng mặc định
          theo <code>AI_CHAT_API_MODEL</code> trong <code>.env.local</code>.
        </div>

        <div className="field-group">
          <label>Model hiện đang dùng</label>
          <div style={{ fontSize: 13 }}>
            {loadingSettings ? (
              'Đang tải...'
            ) : (
              <>
                <code>{effectiveModel || '(chưa cấu hình AI_CHAT_API_MODEL)'}</code>{' '}
                {!chatModel && defaultModel && (
                  <span style={{ color: 'var(--text-muted)' }}>(mặc định từ .env.local)</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="field-group">
          <label>Chọn model khác (danh sách lấy trực tiếp từ 9router)</label>
          {loadingModels && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Đang tải danh sách model...</div>}
          {!loadingModels && modelsError && (
            <div className="banner">
              ⚠️ {modelsError}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn" onClick={loadModels}>
                  Thử lại
                </button>
              </div>
            </div>
          )}
          {!loadingModels && !modelsError && models && (
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setSaveOk(false);
              }}
              disabled={saving}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 7,
                color: 'var(--text)',
                fontFamily: 'var(--font)',
                fontSize: 13,
                padding: '8px 12px',
              }}
            >
              <option value="">— Dùng mặc định ({defaultModel || 'chưa cấu hình'}) —</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                  {m.ownedBy ? ` (${m.ownedBy})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {saveError && <div className="banner">{saveError}</div>}
        {saveOk && !saveError && <div className="banner banner-info">✅ Đã lưu cấu hình model.</div>}

        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/" className="btn">
            ← Quay lại
          </Link>
          <button type="button" className="btn" onClick={handleReset} disabled={saving || loadingSettings}>
            Về mặc định
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loadingModels}>
            {saving ? 'Đang lưu...' : '💾 Lưu cấu hình'}
          </button>
        </div>
      </div>
    </div>
  );
}
