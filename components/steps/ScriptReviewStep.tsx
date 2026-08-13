'use client';

import { useRef, useState } from 'react';
import type { Project, Scene } from '@/lib/types';
import { SCRIPT_ANGLES } from '@/lib/scriptAngles';

type View = 'all' | 'voiceover' | 'prompts';

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `new-scene-${localIdCounter}`;
}

function buildEmptyLocalScene(order: number): Scene {
  return {
    id: nextLocalId(),
    order,
    label: `Cảnh mới ${order}`,
    duration: 6,
    camera: 'static',
    voiceoverVi: '',
    onScreenText: '',
    veoPrompt: '',
    negativePrompt: '',
    status: 'idle',
    jobId: null,
    videoPath: null,
    error: null,
    attempts: 0,
    lastUpdatedAt: null,
    lastFramePath: null,
    chainedFromPrevious: false,
  };
}

export function ScriptReviewStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState<View>('all');
  const [scenes, setScenes] = useState<Scene[]>(project.script.scenes);
  const [saving, setSaving] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scriptAngleId, setScriptAngleId] = useState<string | null>(project.scriptAngleId);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function updateScene(id: string, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeScene(id: string) {
    setScenes((prev) => prev.filter((s) => s.id !== id));
  }

  function addScene() {
    setScenes((prev) => [...prev, buildEmptyLocalScene(prev.length + 1)]);
  }

  function handleDrop(targetIndex: number) {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === targetIndex) return;
    setScenes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  async function saveScenes(scenesToSave: Scene[]): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/script`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: scenesToSave.map((s) => ({
            id: s.id,
            voiceoverVi: s.voiceoverVi,
            onScreenText: s.onScreenText,
            veoPrompt: s.veoPrompt,
            negativePrompt: s.negativePrompt,
            duration: s.duration,
            camera: s.camera,
            label: s.label,
            type: s.type,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Lưu thất bại');
        return false;
      }
      if (data.warning) {
        setError(data.warning);
        return false;
      }
      if (data.script?.scenes) {
        setScenes(data.script.scenes);
      }
      await onRefresh();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveScenes(scenes);
    } finally {
      setSaving(false);
    }
  }

  async function runGenerateDraft() {
    setGeneratingDraft(true);
    setError(null);
    setConfirmRegenerate(false);
    setProgressMessage('Đang gửi yêu cầu tới AI...');
    try {
      const res = await fetch(`/api/projects/${project.id}/script/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptAngleId }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Sinh nháp AI thất bại');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let handled = false;

      const handleEvent = (raw: string) => {
        let event: {
          type?: string;
          attempt?: number;
          maxAttempts?: number;
          message?: string;
          draft?: Scene[];
          scriptAngleId?: string;
        };
        try {
          event = JSON.parse(raw);
        } catch {
          return;
        }
        if (event.type === 'start') {
          setProgressMessage(
            event.attempt && event.attempt > 1
              ? `Đang thử lại lần ${event.attempt}/${event.maxAttempts}...`
              : 'AI đang viết kịch bản, có thể mất 1-2 phút...'
          );
        } else if (event.type === 'retry') {
          setProgressMessage(`Gặp lỗi tạm thời, sẽ thử lại lần ${event.attempt}/${event.maxAttempts}...`);
        } else if (event.type === 'result' && event.draft) {
          handled = true;
          // Thay thế hoàn toàn danh sách cảnh hiện tại bằng cấu trúc do AI thiết kế theo góc đã chọn
          // (không còn merge theo id — AI có thể đổi hẳn số lượng/loại cảnh).
          // Route đã tự lưu xuống project.json — không cần gọi saveScenes() thêm.
          setScenes(event.draft);
        } else if (event.type === 'error') {
          handled = true;
          setError(event.message || 'Sinh nháp AI thất bại');
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = rawEvent.split('\n').find((l) => l.startsWith('data:'));
          if (line) handleEvent(line.slice(5).trim());
        }
      }

      if (!handled) {
        setError('Kết nối tới AI bị ngắt trước khi hoàn tất, vui lòng thử lại');
      }

      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgressMessage(null);
      setGeneratingDraft(false);
    }
  }

  function handleGenerateDraft() {
    if (!scriptAngleId) {
      setError('Cần chọn 1 góc kịch bản trước khi sinh nháp bằng AI');
      return;
    }
    const hasValuableData = scenes.some((s) => !!s.videoPath || s.status === 'generating');
    if (hasValuableData) {
      setConfirmRegenerate(true);
      return;
    }
    runGenerateDraft();
  }

  async function handleGoStep(step: number) {
    const ok = await saveScenes(scenes);
    if (ok) onGoStep(step);
  }

  return (
    <div className="card">
      <div className="card-header">
        📝 <span>Bước 2 — Duyệt &amp; chỉnh sửa kịch bản</span>
        <span className="badge badge-pending">Cần duyệt</span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={() => handleGoStep(1)} disabled={saving || generatingDraft}>
          ← Quay lại
        </button>
        <button className="btn" onClick={handleGenerateDraft} disabled={generatingDraft}>
          {generatingDraft ? 'Đang sinh...' : '✨ Sinh nháp bằng AI'}
        </button>
        <button className="btn" onClick={handleSave} disabled={saving || generatingDraft}>
          {saving ? 'Đang lưu...' : '💾 Lưu'}
        </button>
        <button className="btn btn-primary" onClick={() => handleGoStep(3)} disabled={saving || generatingDraft}>
          ✓ Duyệt xong → Storyboard ảnh
        </button>
      </div>

      <div className="field-group">
        <label>Chọn góc kịch bản (dùng để sinh nháp AI ở bước dưới)</label>
        <div className="angle-grid">
          {SCRIPT_ANGLES.map((angle) => (
            <button
              key={angle.id}
              type="button"
              className={`angle-card ${scriptAngleId === angle.id ? 'active' : ''}`}
              onClick={() => setScriptAngleId(angle.id)}
            >
              <div className="angle-title">{angle.title}</div>
              <div className="angle-desc">{angle.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="banner banner-info">
        Nút &quot;Sinh nháp bằng AI&quot; để AI tự thiết kế <strong>cả cấu trúc cảnh</strong> (số lượng, loại
        cảnh, thời lượng) phù hợp nhất với <strong>góc đã chọn ở trên</strong>, dựa trên{' '}
        <strong>mô tả text sản phẩm</strong> bạn nhập ở Bước 1 — AI không phân tích trực tiếp ảnh đã upload.
        Danh sách cảnh trong template ở Bước 1 chỉ mang tính tham khảo, không còn bắt buộc.
      </div>

      {confirmRegenerate && (
        <div className="banner">
          ⚠️ Đã có cảnh đang gen hoặc đã gen xong video. Sinh nháp mới sẽ{' '}
          <strong>thay thế toàn bộ danh sách cảnh hiện tại</strong> theo cấu trúc AI đề xuất — video đã gen sẽ
          mất liên kết (file vẫn còn trên đĩa).
          <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
            <button className="btn btn-danger" onClick={runGenerateDraft} disabled={generatingDraft}>
              Vẫn sinh nháp mới
            </button>
            <button className="btn" onClick={() => setConfirmRegenerate(false)} disabled={generatingDraft}>
              Huỷ
            </button>
          </div>
        </div>
      )}

      <div className="toggle-group">
        <button className={`toggle-btn ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
          Tất cả
        </button>
        <button className={`toggle-btn ${view === 'voiceover' ? 'active' : ''}`} onClick={() => setView('voiceover')}>
          Voiceover
        </button>
        <button className={`toggle-btn ${view === 'prompts' ? 'active' : ''}`} onClick={() => setView('prompts')}>
          Prompt Veo
        </button>
      </div>

      <div>
        {scenes.map((scene, i) => {
          const locked = scene.status === 'generating';
          return (
            <div
              key={scene.id}
              className={`script-edit-row ${dragOverIndex === i ? 'drag-over' : ''}`}
              draggable={!locked}
              onDragStart={() => {
                dragIndexRef.current = i;
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverIndex(i);
              }}
              onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(i);
              }}
            >
              <div className="scene-row-header">
                <span className="drag-handle" title="Kéo để sắp xếp lại">
                  ⠿
                </span>
                <input
                  type="text"
                  className="scene-label-input"
                  value={scene.label}
                  placeholder="Tên cảnh..."
                  onChange={(e) => updateScene(scene.id, { label: e.target.value })}
                />
                <input
                  type="number"
                  className="scene-duration-input"
                  value={scene.duration}
                  min={1}
                  onChange={(e) => updateScene(scene.id, { duration: Number(e.target.value) || 0 })}
                />
                <span className="scene-duration-suffix">s</span>
                <input
                  type="text"
                  className="scene-camera-input"
                  value={scene.camera}
                  placeholder="camera..."
                  onChange={(e) => updateScene(scene.id, { camera: e.target.value })}
                />
                {scene.type && <span className="scene-type-badge">{scene.type}</span>}
                <button
                  type="button"
                  className="scene-remove-btn"
                  onClick={() => removeScene(scene.id)}
                  disabled={locked}
                  title={locked ? 'Cảnh đang generating, không thể xoá' : 'Xoá cảnh'}
                >
                  🗑️
                </button>
              </div>
              {(view === 'all' || view === 'voiceover') && (
                <textarea
                  rows={2}
                  placeholder="Voiceover tiếng Việt..."
                  value={scene.voiceoverVi}
                  onChange={(e) => updateScene(scene.id, { voiceoverVi: e.target.value })}
                />
              )}
              {view === 'all' && (
                <input
                  type="text"
                  placeholder="On-screen text..."
                  value={scene.onScreenText}
                  onChange={(e) => updateScene(scene.id, { onScreenText: e.target.value })}
                />
              )}
              {(view === 'all' || view === 'prompts') && (
                <textarea
                  rows={3}
                  placeholder="Veo prompt (tiếng Anh)..."
                  value={scene.veoPrompt}
                  onChange={(e) => updateScene(scene.id, { veoPrompt: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>

      <button type="button" className="btn add-scene-btn" onClick={addScene}>
        + Thêm cảnh
      </button>

      {error && <div className="banner">{error}</div>}
      {generatingDraft && (
        <div className="banner banner-info">⏳ {progressMessage || 'AI đang viết kịch bản...'}</div>
      )}
    </div>
  );
}
