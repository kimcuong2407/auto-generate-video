'use client';

import { CHATGPT_EXTENSION_MODEL } from '@/lib/imageModels';

import { useEffect, useState } from 'react';
import { TopNav } from '@/components/TopNav';

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

  const [imageModel, setImageModel] = useState<string | null>(null);
  const [imageOptions, setImageOptions] = useState<{ value: string; label: string }[]>([]);
  const [defaultImageModel, setDefaultImageModel] = useState<string>('');
  const [savingImage, setSavingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState(false);
  // Extension gen ảnh có đang kết nối không — chỉ hiện khi chọn provider extension.
  const [extOnline, setExtOnline] = useState<boolean | null>(null);

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
      setImageModel(data.imageModel || null);
      setImageOptions(data.imageModelOptions || []);
      setDefaultImageModel(data.defaultImageModel || '');
    } finally {
      setLoadingSettings(false);
    }
  }

  useEffect(() => {
    loadModels();
    loadSettings();
  }, []);

  // Poll trạng thái extension khi (và chỉ khi) đang chọn provider extension — không chọn thì
  // hỏi làm gì cho tốn request.
  useEffect(() => {
    if (imageModel !== CHATGPT_EXTENSION_MODEL) {
      setExtOnline(null);
      return;
    }
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch('/api/chatgpt-image/status');
        const data = await res.json();
        if (alive) setExtOnline(Boolean(data.online));
      } catch {
        if (alive) setExtOnline(false);
      }
    };
    check();
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [imageModel]);

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

  async function handleSaveImageModel(next: string) {
    setSavingImage(true);
    setImageError(null);
    setImageOk(false);
    try {
      const res = await fetch('/api/ai-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageModel: next || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImageError(data.error || 'Lưu provider gen ảnh thất bại');
        return;
      }
      setImageModel(data.imageModel || null);
      setImageOk(true);
    } catch (err) {
      setImageError((err as Error).message);
    } finally {
      setSavingImage(false);
    }
  }

  const effectiveModel = chatModel || defaultModel;
  const effectiveImageModel = imageModel || defaultImageModel;
  const imageLabel =
    imageOptions.find((o) => o.value === effectiveImageModel)?.label || effectiveImageModel;

  return (
    <div className="page-shell">
      <TopNav />
      <div className="home-wrap">
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
          <button type="button" className="btn" onClick={handleReset} disabled={saving || loadingSettings}>
            Về mặc định
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loadingModels}>
            {saving ? 'Đang lưu...' : '💾 Lưu cấu hình'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          🖼️ <span>Provider gen ảnh (áp dụng toàn hệ thống)</span>
        </div>

        <div className="banner banner-info">
          Ép provider cho <strong>mọi luồng gen ảnh</strong> — storyboard, background project,
          background livestream — đè lên lựa chọn trong từng project/job. Không chọn gì = tôn trọng
          cấu hình riêng của từng job như trước.
        </div>

        <div className="field-group">
          <label>Provider đang dùng</label>
          <div style={{ fontSize: 13 }}>
            {loadingSettings ? (
              'Đang tải...'
            ) : (
              <>
                <code>{imageLabel || '(chưa cấu hình)'}</code>{' '}
                {!imageModel && (
                  <span style={{ color: 'var(--text-muted)' }}>(mặc định, job tự chọn)</span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="field-group">
          <label>Ép provider cho mọi luồng gen ảnh</label>
          <select
            value={imageModel || ''}
            disabled={savingImage || loadingSettings}
            onChange={(e) => handleSaveImageModel(e.target.value)}
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
            <option value="">— Không ép (mỗi job tự chọn) —</option>
            {imageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {imageModel === CHATGPT_EXTENSION_MODEL && (
          <div className={extOnline ? 'banner banner-info' : 'banner'}>
            {extOnline
              ? '✅ Extension đang kết nối — job gen ảnh sẽ chạy trong Chrome này.'
              : '⚠️ Chưa thấy extension. Mở Chrome có cài extension ChatGPT Image Worker và một tab chatgpt.com đã đăng nhập; ảnh chỉ gen được khi Chrome đang mở.'}
          </div>
        )}
        {imageModel === 'chatgpt-local' && (
          <div className="banner">
            ⚠️ &quot;ChatGPT (tài khoản riêng)&quot; cần server có profile Chrome đã đăng nhập ChatGPT
            tại <code>data/chatgpt-profiles/</code>. Kiểm tra ở tab{' '}
            <strong>Tài khoản ChatGPT</strong> — chưa có profile thì gen sẽ lỗi.
          </div>
        )}
        {imageError && <div className="banner">{imageError}</div>}
        {imageOk && !imageError && <div className="banner banner-info">✅ Đã lưu provider gen ảnh.</div>}
      </div>
      </div>
    </div>
  );
}
