'use client';

import { useCallback, useState } from 'react';
import type { Project, StoryboardImage, StoryboardStatus } from '@/lib/types';
import { MediaModal } from '@/components/MediaModal';
import { IMAGE_MODEL_OPTIONS, defaultProductReferenceImage } from '@/lib/imageModels';
import { runStoryboardBatchSSE, type BatchStreamEvent } from '@/lib/client/storyboardBatch';
import { useStatusBanner } from '@/components/StatusBanner';

function statusClass(s: StoryboardStatus): string {
  return (
    { idle: 'status-queued', generating: 'status-gen', done: 'status-ready', failed: 'status-failed' }[s] ||
    'status-queued'
  );
}

function statusText(s: StoryboardStatus): string {
  return { idle: 'Sẵn sàng', generating: '⏳ Đang gen...', done: '✅ Xong', failed: '❌ Lỗi' }[s] || 'Sẵn sàng';
}

/**
 * Thanh tiến độ của một loạt gen ảnh: đếm theo trạng thái THẬT trong project (đã được poll 4.5s
 * một lần), không phải theo cờ busy của nút bấm.
 *
 * Vì sao cần: route gen hàng loạt chỉ trả lời SAU KHI cả loạt xong (`await runWithConcurrency`),
 * nên trong suốt vài phút chạy, nút chỉ hiện "Đang gen tất cả..." — không biết đang ở ảnh nào,
 * còn mấy ảnh, ảnh nào vừa lỗi. Đọc từ project thì thấy đúng ảnh đang chạy kể cả khi Mr.D vừa
 * F5 trang giữa chừng (cờ busy mất sau reload, trạng thái trong project thì không).
 *
 * Hiện tên cảnh đang gen chứ không chỉ con số: ảnh gen song song (STORYBOARD_MAX_CONCURRENT,
 * mặc định 2) nên "đang gen 2 ảnh" mà không nói ảnh nào là thông tin nửa vời.
 */
export interface GenerateProgressStats {
  total: number;
  done: number;
  failed: number;
  /** Ảnh đang gen — giữ nguyên object để hiện được TÊN CẢNH, không chỉ đếm số. */
  running: StoryboardImage[];
  waiting: number;
  finished: number;
  percent: number;
  /** false = loạt gen chưa khởi động, không hiện thanh nào. */
  visible: boolean;
}

/**
 * Phép đếm của thanh tiến độ, tách thành hàm THUẦN để self-check chạy được mà không cần dựng
 * React (xem scripts/check-storyboard-progress.ts).
 */
export function computeProgress(images: StoryboardImage[]): GenerateProgressStats {
  const total = images.length;
  const done = images.filter((i) => i.status === 'done').length;
  const failed = images.filter((i) => i.status === 'failed').length;
  const running = images.filter((i) => i.status === 'generating');
  // Chờ = chưa đụng tới VÀ có prompt: ảnh chưa có prompt không nằm trong loạt gen (route lọc
  // `img.prompt.trim()`), đếm nó vào hàng chờ là hứa một thứ sẽ không bao giờ chạy.
  const waiting = images.filter((i) => i.status === 'idle' && i.prompt.trim()).length;
  const finished = done + failed;
  return {
    total,
    done,
    failed,
    running,
    waiting,
    finished,
    // total = 0 thì `visible` đã false, nhưng vẫn chặn chia 0 ở đây: hàm thuần này có thể được
    // gọi từ chỗ khác sau này, trả về NaN là lỗi lan âm thầm ra tận style width.
    percent: total === 0 ? 0 : Math.round((finished / total) * 100),
    // Không có gì đang chạy và cũng chưa xong cái nào → loạt gen chưa bắt đầu.
    visible: total > 0 && (running.length > 0 || done > 0 || failed > 0),
  };
}

/**
 * Vì sao một loạt gen sẽ KHÔNG chạy được ảnh nào — hoặc null nếu có ít nhất 1 ảnh chạy được.
 *
 * Bộ lọc ở đây PHẢI khớp đúng route (`status idle|failed` && `prompt.trim()`, xem
 * generate-backgrounds/route.ts). Lệch một điều kiện là UI chặn nhầm một loạt gen chạy được,
 * hoặc thả cho gọi API rồi lại im lặng — đúng bug này.
 *
 * Vì sao chặn ở client thay vì để route trả lỗi: route trả stream, "không có gì để gen" là một
 * loạt rỗng hợp lệ chứ không phải lỗi HTTP. Nói lý do ngay tại chỗ bấm là đường ngắn nhất.
 */
export function describeNothingToGenerate(
  kind: 'storyboard' | 'background',
  images: StoryboardImage[]
): string | null {
  const what = kind === 'background' ? 'ảnh background' : 'ảnh storyboard';
  if (images.length === 0) return `Chưa có ${what} nào — cần duyệt kịch bản ở Bước 2 trước.`;

  const runnable = images.filter(
    (i) => (i.status === 'idle' || i.status === 'failed') && i.prompt.trim()
  );
  if (runnable.length > 0) return null;

  const missingPrompt = images.filter(
    (i) => (i.status === 'idle' || i.status === 'failed') && !i.prompt.trim()
  ).length;
  const generating = images.filter((i) => i.status === 'generating').length;
  const done = images.filter((i) => i.status === 'done').length;

  if (generating > 0) {
    return `${generating} ${what} đang gen dở — chờ xong rồi bấm lại.`;
  }
  if (missingPrompt > 0) {
    const button =
      kind === 'background' ? '✨ Sinh prompt background tất cả bằng AI' : '✨ Sinh prompt tất cả bằng AI';
    return `Không gen được: ${missingPrompt}/${images.length} ${what} chưa có prompt (đã xong ${done}). Bấm "${button}" trước, hoặc tự nhập prompt vào ô của từng ảnh.`;
  }
  return `Tất cả ${what} đã gen xong (${done}/${images.length}) — không còn gì để gen. Muốn gen lại thì bấm Retry ở từng ảnh.`;
}

function GenerateProgress({
  label,
  images,
  labelById,
  liveStatus,
}: {
  label: string;
  images: StoryboardImage[];
  labelById: Map<string, string>;
  /** Dòng trạng thái realtime từ SSE — nói được thứ project.json không lưu: đang thử lần mấy,
   *  còn chờ bao lâu trước khi retry. Null = loạt này không chạy trong tab hiện tại. */
  liveStatus?: string | null;
}) {
  const { total, failed, running, waiting, finished, percent, visible } = computeProgress(images);
  // Có liveStatus nghĩa là Mr.D vừa bấm gen: hiện thanh ngay cả khi chưa ảnh nào đổi trạng thái,
  // nếu không thì khoảng vài giây đầu màn hình im lìm như chưa nhận lệnh.
  if (!visible && !liveStatus) return null;

  return (
    <div
      style={{
        margin: '10px 0',
        padding: 10,
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface2, rgba(255,255,255,0.03))',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
        <strong>{label}</strong>
        <span style={{ color: 'var(--text-muted)' }}>
          {finished}/{total} xong{failed > 0 ? ` · ${failed} lỗi` : ''}
          {waiting > 0 ? ` · ${waiting} chờ` : ''}
        </span>
      </div>

      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: 'var(--border)',
          overflow: 'hidden',
          margin: '6px 0',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: failed > 0 ? 'var(--danger, #f87171)' : 'var(--accent, #4ade80)',
            transition: 'width 0.3s',
          }}
        />
      </div>

      {/* Ưu tiên dòng SSE: nó biết cả pha chờ retry — lúc đó KHÔNG ảnh nào ở trạng thái
          'generating' nên nhánh dưới sẽ báo nhầm là "đã dừng" trong khi loạt vẫn đang chạy. */}
      {liveStatus ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{liveStatus}</div>
      ) : running.length > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          ⏳ Đang gen: {running.map((i) => labelById.get(i.sceneId) || i.sceneId).join(', ')}
          {waiting > 0 && ` — ${waiting} ảnh còn lại vào hàng chờ`}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {failed > 0 ? 'Đã dừng — bấm Retry ở ảnh lỗi để chạy lại.' : 'Đã gen xong toàn bộ.'}
        </div>
      )}
    </div>
  );
}

function ImageThumb({
  src,
  alt,
  onClick,
}: {
  src: string | null;
  alt: string;
  onClick?: () => void;
}) {
  return src ? (
    <img
      src={src}
      alt={alt}
      onClick={onClick}
      style={{
        width: 140,
        height: 140,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--border)',
        cursor: onClick ? 'zoom-in' : undefined,
      }}
    />
  ) : (
    <div
      style={{
        width: 140,
        height: 140,
        borderRadius: 8,
        border: '1px dashed var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        color: 'var(--text-muted)',
        textAlign: 'center',
        padding: 8,
      }}
    >
      Chưa có ảnh
    </div>
  );
}

export function StoryboardStep({
  project,
  onGoStep,
  onRefresh,
}: {
  project: Project;
  onGoStep: (step: number) => void;
  onRefresh: () => Promise<void>;
}) {
  const [prompts, setPrompts] = useState<Record<string, string>>(
    Object.fromEntries(project.storyboard.images.map((img) => [img.sceneId, img.prompt]))
  );
  const [backgroundPrompts, setBackgroundPrompts] = useState<Record<string, string>>(
    Object.fromEntries(project.storyboard.backgrounds.map((img) => [img.sceneId, img.prompt]))
  );
  const [saving, setSaving] = useState(false);
  const [busySceneId, setBusySceneId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [busyBackgroundSceneId, setBusyBackgroundSceneId] = useState<string | null>(null);
  const [busyBackgroundAll, setBusyBackgroundAll] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  // Lỗi/lý-do hiện ở BĂNG HEADER (cố định, không trôi khi cuộn) thay vì banner trong card —
  // xem components/StatusBanner.tsx.
  const { show: showBanner } = useStatusBanner();
  const setError = useCallback((msg: string | null) => showBanner(msg, 'error'), [showBanner]);
  /**
   * Dòng trạng thái realtime của loạt gen đang chạy, dựng từ SSE.
   *
   * Vì sao cần state riêng khi đã có thanh tiến độ đọc từ project: project.json chỉ lưu trạng thái
   * CUỐI của mỗi ảnh (idle/generating/done/failed). Nó không biết ảnh đang chạy là lần thử thứ
   * mấy, hay đang nằm chờ backoff trước khi thử lại — mà đó đúng là lúc màn hình trông như bị treo
   * nhất, cần chữ giải thích nhất.
   *
   * `kind` để hiện dòng này đúng dưới thanh tiến độ của loạt tương ứng.
   */
  const [batchStatus, setBatchStatus] = useState<{
    kind: 'storyboard' | 'background';
    text: string;
  } | null>(null);
  const [modal, setModal] = useState<{ src: string; alt: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ sceneId: string; kind: 'storyboard' | 'background' } | null>(
    null
  );
  const [promptBusySceneId, setPromptBusySceneId] = useState<string | null>(null);
  const [promptBusyAll, setPromptBusyAll] = useState(false);
  const [promptBusyBackgroundSceneId, setPromptBusyBackgroundSceneId] = useState<string | null>(null);
  const [promptBusyBackgroundAll, setPromptBusyBackgroundAll] = useState(false);

  const labelById = new Map(project.script.scenes.map((s) => [s.id, s.label]));
  const backgroundById = new Map(project.storyboard.backgrounds.map((img) => [img.sceneId, img]));
  const allDone = project.storyboard.images.every((img) => img.status === 'done');

  async function saveAllPrompts(): Promise<boolean> {
    setError(null);
    try {
      // Chỉ gửi những ảnh có prompt thực sự thay đổi và KHÔNG đang generating.
      // Tránh gửi ảnh đang chạy (server sẽ trả warning "Không thể sửa ảnh đang generating"),
      // đồng thời tránh gửi thừa các ảnh không đổi.
      const changedImages = project.storyboard.images
        .filter((img) => img.status !== 'generating')
        .filter((img) => (prompts[img.sceneId] ?? img.prompt) !== img.prompt)
        .map((img) => ({ sceneId: img.sceneId, prompt: prompts[img.sceneId] ?? img.prompt }));
      const changedBackgrounds = project.storyboard.backgrounds
        .filter((img) => img.status !== 'generating')
        .filter((img) => (backgroundPrompts[img.sceneId] ?? img.prompt) !== img.prompt)
        .map((img) => ({ sceneId: img.sceneId, prompt: backgroundPrompts[img.sceneId] ?? img.prompt }));

      // Không có gì để lưu → coi như thành công, không cần gọi API.
      if (changedImages.length === 0 && changedBackgrounds.length === 0) {
        return true;
      }

      const res = await fetch(`/api/projects/${project.id}/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: changedImages, backgrounds: changedBackgrounds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Lưu prompt thất bại');
        return false;
      }
      if (data.warning) {
        setError(data.warning);
        return false;
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
      await saveAllPrompts();
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateSettings(patch: {
    model?: string;
    backgroundModel?: string;
    useProductReference?: boolean;
    productReferenceImagePath?: string | null;
    useSpokespersonReference?: boolean;
  }) {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Cập nhật cài đặt thất bại');
      await onRefresh();
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleGenerate(sceneId: string) {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen ảnh thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }

  async function handleGeneratePrompt(sceneId: string) {
    setPromptBusySceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-prompt`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt bằng AI thất bại');
        return;
      }
      setPrompts((prev) => ({ ...prev, [sceneId]: data.prompt }));
      await onRefresh();
    } finally {
      setPromptBusySceneId(null);
    }
  }

  async function handleGeneratePromptsAll() {
    setPromptBusyAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-prompts`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt bằng AI thất bại');
        return;
      }
      if (data.failed?.length) {
        setError(`Một số cảnh sinh prompt lỗi: ${data.failed.map((f: { sceneId: string }) => f.sceneId).join(', ')}`);
      }
      const res2 = await fetch(`/api/projects/${project.id}/storyboard`);
      const data2 = await res2.json();
      if (res2.ok && data2.storyboard?.images) {
        setPrompts(
          Object.fromEntries(
            (data2.storyboard.images as StoryboardImage[]).map((img) => [img.sceneId, img.prompt])
          )
        );
      }
      await onRefresh();
    } finally {
      setPromptBusyAll(false);
    }
  }

  async function handleStop(sceneId: string) {
    setBusySceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/stop`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Dừng thất bại');
      await onRefresh();
    } finally {
      setBusySceneId(null);
    }
  }


  /**
   * Chạy 1 loạt gen ảnh qua SSE và dịch từng event thành câu tiếng Việt hiện dưới thanh tiến độ.
   *
   * onRefresh() gọi sau MỖI ảnh xong (không đợi hết loạt): thumbnail và trạng thái card hiện ra
   * ngay lúc ảnh đó xong, thay vì đứng im rồi hiện ào một lượt ở cuối.
   */
  async function runBatch(kind: 'storyboard' | 'background', url: string) {
    const labelOf = (sceneId: string) => labelById.get(sceneId) || sceneId;
    try {
      await runStoryboardBatchSSE(url, (event: BatchStreamEvent) => {
        switch (event.type) {
          case 'start':
            setBatchStatus({
              kind,
              text:
                event.total === 0
                  ? 'Không có ảnh nào cần gen (ảnh đã xong hoặc chưa có prompt).'
                  : `Bắt đầu gen tuần tự ${event.total} ảnh...`,
            });
            break;
          case 'image-start':
            setBatchStatus({
              kind,
              text:
                `⏳ Ảnh ${event.index + 1}: ${labelOf(event.sceneId)}` +
                (event.attempt > 1 ? ` — thử lại lần ${event.attempt}/${event.maxAttempts}` : ''),
            });
            break;
          case 'image-retry':
            setBatchStatus({
              kind,
              text: `⚠️ ${labelOf(event.sceneId)} lỗi (${event.error}) — chờ ${Math.round(
                event.waitMs / 1000
              )}s rồi thử lại lần ${event.attempt + 1}...`,
            });
            break;
          case 'image-done':
            setBatchStatus({
              kind,
              text: event.ok
                ? `✅ Xong ảnh ${event.index + 1}: ${labelOf(event.sceneId)}${
                    event.attempts > 1 ? ` (sau ${event.attempts} lần thử)` : ''
                  }`
                : `❌ ${labelOf(event.sceneId)} hỏng sau ${event.attempts} lần thử: ${event.error}`,
            });
            // Ảnh vừa xong — kéo project về ngay để hiện thumbnail, không đợi hết loạt.
            void onRefresh();
            break;
          case 'done':
            // Loạt rỗng: GIỮ nguyên câu giải thích của event 'start'. Ghi đè bằng
            // "Hoàn tất: 0/0 ảnh xong" là xoá mất lý do vì sao không có gì chạy — đúng ca
            // Mr.D gặp: bấm nút, thấy một dòng vô nghĩa chớp qua, tưởng nút hỏng.
            if (event.total === 0) break;
            setBatchStatus({
              kind,
              text:
                event.failed > 0
                  ? `Hoàn tất: ${event.succeeded}/${event.total} ảnh xong, ${event.failed} ảnh hỏng — bấm Retry ở từng ảnh lỗi.`
                  : `Hoàn tất: ${event.succeeded}/${event.total} ảnh xong.`,
            });
            break;
          case 'fatal':
            setError(event.message);
            break;
        }
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await onRefresh();
    }
  }

  async function handleGenerateAll() {
    const saved = await saveAllPrompts();
    if (!saved) return;
    const blocker = describeNothingToGenerate('storyboard', project.storyboard.images);
    if (blocker) {
      setError(blocker);
      return;
    }
    setBusyAll(true);
    setError(null);
    setBatchStatus(null);
    try {
      await runBatch('storyboard', `/api/projects/${project.id}/storyboard/generate-all`);
    } finally {
      setBusyAll(false);
    }
  }

  async function handleGenerateBackground(sceneId: string) {
    const saved = await saveAllPrompts();
    if (!saved) return;
    setBusyBackgroundSceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-background`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Gen ảnh background thất bại');
      await onRefresh();
    } finally {
      setBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundPrompt(sceneId: string) {
    setPromptBusyBackgroundSceneId(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/generate-background-prompt`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt background bằng AI thất bại');
        return;
      }
      setBackgroundPrompts((prev) => ({ ...prev, [sceneId]: data.prompt }));
      await onRefresh();
    } finally {
      setPromptBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundPromptsAll() {
    setPromptBusyBackgroundAll(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/generate-background-prompts`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Sinh prompt background bằng AI thất bại');
        return;
      }
      if (data.failed?.length) {
        setError(`Một số cảnh sinh prompt background lỗi: ${data.failed.map((f: { sceneId: string }) => f.sceneId).join(', ')}`);
      }
      const res2 = await fetch(`/api/projects/${project.id}/storyboard`);
      const data2 = await res2.json();
      if (res2.ok && data2.storyboard?.backgrounds) {
        setBackgroundPrompts(
          Object.fromEntries(
            (data2.storyboard.backgrounds as StoryboardImage[]).map((img) => [img.sceneId, img.prompt])
          )
        );
      }
      await onRefresh();
    } finally {
      setPromptBusyBackgroundAll(false);
    }
  }

  async function handleStopBackground(sceneId: string) {
    setBusyBackgroundSceneId(sceneId);
    try {
      const res = await fetch(`/api/projects/${project.id}/storyboard/${sceneId}/stop-background`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Dừng thất bại');
      await onRefresh();
    } finally {
      setBusyBackgroundSceneId(null);
    }
  }

  async function handleGenerateBackgroundAll() {
    const saved = await saveAllPrompts();
    if (!saved) return;
    // Chặn TRƯỚC khi gọi API: route lọc bỏ ảnh không có prompt nên loạt gen sẽ kết thúc ngay,
    // và người bấm không nhận được lý do nào. Báo thẳng ở đây, kèm việc cần làm tiếp.
    const blocker = describeNothingToGenerate('background', project.storyboard.backgrounds);
    if (blocker) {
      setError(blocker);
      return;
    }
    setBusyBackgroundAll(true);
    setError(null);
    setBatchStatus(null);
    try {
      await runBatch('background', `/api/projects/${project.id}/storyboard/generate-backgrounds`);
    } finally {
      setBusyBackgroundAll(false);
    }
  }

  async function handleGoStep(step: number) {
    const ok = await saveAllPrompts();
    if (ok) onGoStep(step);
  }

  const anyBusy = saving || busyAll || busyBackgroundAll;

  return (
    <div className="card">
      <div className="card-header">
        🖼️ <span>Bước 3 — Storyboard ảnh (Google Flow)</span>
        <span className={`badge ${allDone ? 'badge-done' : 'badge-pending'}`}>{allDone ? 'Done' : 'Chưa xong'}</span>
      </div>

      <div className="step-actions">
        <button className="btn" onClick={() => handleGoStep(2)} disabled={anyBusy}>
          ← Quay lại
        </button>
        <button className="btn" onClick={handleSave} disabled={anyBusy}>
          {saving ? 'Đang lưu...' : '💾 Lưu prompt'}
        </button>
        <button
          className="btn"
          onClick={handleGeneratePromptsAll}
          disabled={promptBusyAll || promptBusySceneId !== null || busyAll}
        >
          {promptBusyAll ? 'Đang sinh prompt...' : '✨ Sinh prompt tất cả bằng AI'}
        </button>
        <button
          className="btn"
          onClick={handleGenerateBackgroundPromptsAll}
          disabled={promptBusyBackgroundAll || promptBusyBackgroundSceneId !== null || busyBackgroundAll}
        >
          {promptBusyBackgroundAll ? 'Đang sinh prompt background...' : '✨ Sinh prompt background tất cả bằng AI'}
        </button>
        {/* Khoá CHÉO hai nút: mỗi loạt đã chạy tuần tự để không dồn tải lên Flow, mở cho bấm cả
            hai cùng lúc là lại thành 2 lượt gọi song song — đúng thứ vừa bỏ đi. */}
        <button
          className="btn"
          onClick={handleGenerateAll}
          disabled={busyAll || busyBackgroundAll || saving}
          title={busyBackgroundAll ? 'Đang chạy loạt gen background, chờ xong đã' : undefined}
        >
          {busyAll ? 'Đang gen...' : '🎨 Gen tất cả'}
        </button>
        <button
          className="btn"
          onClick={handleGenerateBackgroundAll}
          disabled={busyBackgroundAll || busyAll || saving}
          title={busyAll ? 'Đang chạy loạt gen storyboard, chờ xong đã' : undefined}
        >
          {busyBackgroundAll ? 'Đang gen background...' : '🖼️ Gen background tất cả'}
        </button>
        <button className="btn btn-primary" onClick={() => handleGoStep(4)} disabled={anyBusy}>
          ✓ Xong → Gen video
        </button>
      </div>


      <div className="banner banner-info">
        Mỗi cảnh trong kịch bản đã duyệt ở Bước 2 sẽ có 1 ảnh storyboard tương ứng, sinh qua{' '}
        <strong>Google Flow</strong> — dùng chung tài khoản Google Flow đã đăng nhập ở{' '}
        <a href="/settings/flow">Cài đặt → Flow</a> cho gen video ở Bước 4, không cần API key riêng. Ảnh sản phẩm có
        thể dùng làm ảnh tham chiếu để giữ đúng hình
        dạng/màu sắc sản phẩm thật. Prompt ảnh có thể tự viết tay, hoặc bấm{' '}
        <strong>&quot;✨ Sinh prompt bằng AI&quot;</strong> để AI viết dựa trên thông tin sản phẩm (Bước 1) và nội
        dung cảnh đã duyệt (Bước 2). Ngoài ra, mỗi cảnh còn có thêm 1{' '}
        <strong>ảnh background riêng (chỉ bối cảnh, không có sản phẩm)</strong> — ảnh này chỉ dùng để xem/tải ở
        Bước 3, KHÔNG tự động dùng làm ảnh tham chiếu khi gen video ở Bước 4.
      </div>

      {project.inputs.productImages.length > 0 && (
        <div className="field-group">
          <label>
            Ảnh sản phẩm tham chiếu
            {project.inputs.productImages.length > 1 && ' — chọn đúng 1 ảnh để gửi làm ref, bấm ảnh để xem to'}
          </label>
          <div className="image-preview-grid">
            {project.inputs.productImages.map((p, i) => {
              const selected =
                (project.storyboard.productReferenceImagePath ||
                  defaultProductReferenceImage(project.inputs.productImages)) === p;
              const src = project.inputs.productImageUrls?.[i] || `/api/projects/${project.id}/media/${p}`;
              return (
                <div key={p} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <img
                    className="image-preview-thumb"
                    src={src}
                    alt="Ảnh sản phẩm"
                    onClick={() => setModal({ src, alt: 'Ảnh sản phẩm' })}
                    style={{
                      cursor: 'zoom-in',
                      outline: selected && project.inputs.productImages.length > 1 ? '2px solid var(--accent)' : undefined,
                    }}
                  />
                  {project.inputs.productImages.length > 1 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="productReferenceImage"
                        checked={selected}
                        disabled={savingSettings}
                        onChange={() => handleUpdateSettings({ productReferenceImagePath: p })}
                      />
                      Dùng làm ref
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="field-group">
        <label>Provider gen ảnh storyboard</label>
        <select
          value={project.storyboard.model}
          disabled={savingSettings}
          onChange={(e) => handleUpdateSettings({ model: e.target.value })}
        >
          {IMAGE_MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field-group">
        <label>Provider gen ảnh background</label>
        <select
          value={project.storyboard.backgroundModel}
          disabled={savingSettings}
          onChange={(e) => handleUpdateSettings({ backgroundModel: e.target.value })}
        >
          {IMAGE_MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.storyboard.useProductReference}
            disabled={savingSettings}
            onChange={(e) => handleUpdateSettings({ useProductReference: e.target.checked })}
          />
          Dùng ảnh sản phẩm làm ảnh tham chiếu khi gen storyboard
        </label>
      </div>

      {project.inputs.spokespersonImagePath && (
        <>
          <div className="field-group">
            <label>Ảnh nhân vật tham chiếu (Bước 1) — bấm ảnh để xem to</label>
            <div className="image-preview-grid">
              <img
                className="image-preview-thumb"
                src={
                  project.inputs.spokespersonImageUrl ||
                  `/api/projects/${project.id}/media/${project.inputs.spokespersonImagePath}`
                }
                alt="Ảnh nhân vật"
                style={{ cursor: 'zoom-in' }}
                onClick={() =>
                  setModal({
                    src:
                      project.inputs.spokespersonImageUrl ||
                      `/api/projects/${project.id}/media/${project.inputs.spokespersonImagePath}`,
                    alt: 'Ảnh nhân vật',
                  })
                }
              />
            </div>
          </div>

          <div className="field-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={project.storyboard.useSpokespersonReference}
                disabled={savingSettings}
                onChange={(e) => handleUpdateSettings({ useSpokespersonReference: e.target.checked })}
              />
              Dùng ảnh nhân vật (Bước 1) làm ảnh tham chiếu khi gen storyboard
            </label>
          </div>
        </>
      )}

      {/* Tiến độ đọc từ trạng thái THẬT trong project (poll 4.5s), nên vẫn đúng sau khi F5 giữa
          chừng — khác cờ busy của nút, mất sạch khi reload. Hai loạt gen tách riêng vì chạy độc
          lập: có thể đang gen background trong khi storyboard đã xong từ lâu. */}
      <GenerateProgress
        label="🖼️ Ảnh storyboard"
        images={project.storyboard.images}
        labelById={labelById}
        liveStatus={batchStatus?.kind === 'storyboard' ? batchStatus.text : null}
      />
      <GenerateProgress
        label="🌄 Ảnh background"
        images={project.storyboard.backgrounds}
        labelById={labelById}
        liveStatus={batchStatus?.kind === 'background' ? batchStatus.text : null}
      />

      <div className="scene-list">
        {project.storyboard.images.map((image, i) => {
          const background = backgroundById.get(image.sceneId);
          const imageSrc = image.imageUrl || (image.imagePath ? `/api/projects/${project.id}/media/${image.imagePath}` : null);
          const imageAlt = `Storyboard ${image.sceneId}`;
          return (
          <div key={image.sceneId} className="script-edit-row">
            <div className="scene-row-header">
              <span className="idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="scene-label-input" style={{ border: 'none', background: 'none' }}>
                {labelById.get(image.sceneId) || image.sceneId}
              </span>
              <span className={`status ${statusClass(image.status)}`}>{statusText(image.status)}</span>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <textarea
                rows={3}
                style={{ flex: 1, minWidth: 260 }}
                placeholder="Prompt ảnh storyboard (tiếng Anh)..."
                value={prompts[image.sceneId] ?? ''}
                disabled={image.status === 'generating'}
                onChange={(e) => setPrompts((prev) => ({ ...prev, [image.sceneId]: e.target.value }))}
              />
              <ImageThumb
                src={imageSrc}
                alt={imageAlt}
                onClick={imageSrc ? () => setModal({ src: imageSrc, alt: imageAlt }) : undefined}
              />
            </div>

            {image.error && (
              <div className="script-line" style={{ fontSize: 11, color: 'var(--danger, #f87171)' }}>
                {image.error}
              </div>
            )}

            <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="retry-btn"
                onClick={() => handleGeneratePrompt(image.sceneId)}
                disabled={
                  image.status === 'generating' || promptBusySceneId === image.sceneId || promptBusyAll
                }
              >
                {promptBusySceneId === image.sceneId ? '⏳ Đang sinh...' : '✨ Sinh prompt bằng AI'}
              </button>
              {image.status === 'generating' ? (
                <button
                  className="retry-btn"
                  onClick={() => handleStop(image.sceneId)}
                  disabled={busySceneId === image.sceneId}
                  title="Chỉ dừng theo dõi phía app, không hủy được ảnh đang render bên Google Flow"
                >
                  ⏹ Dừng
                </button>
              ) : (
                <button
                  className="retry-btn"
                  onClick={() => setPreviewTarget({ sceneId: image.sceneId, kind: 'storyboard' })}
                  disabled={busySceneId === image.sceneId || busyAll}
                >
                  {image.status === 'failed' ? '🔄 Retry' : '▶ Gen'}
                </button>
              )}
            </div>

            {background && (() => {
              const backgroundSrc =
                background.imageUrl ||
                (background.imagePath ? `/api/projects/${project.id}/media/${background.imagePath}` : null);
              const backgroundAlt = `Background ${background.sceneId}`;
              return (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                <div className="scene-row-header" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🌄 Ảnh background (chỉ bối cảnh)</span>
                  <span className={`status ${statusClass(background.status)}`}>{statusText(background.status)}</span>
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <textarea
                    rows={3}
                    style={{ flex: 1, minWidth: 260 }}
                    placeholder="Prompt ảnh background (tiếng Anh, không có sản phẩm)..."
                    value={backgroundPrompts[background.sceneId] ?? ''}
                    disabled={background.status === 'generating'}
                    onChange={(e) =>
                      setBackgroundPrompts((prev) => ({ ...prev, [background.sceneId]: e.target.value }))
                    }
                  />
                  <ImageThumb
                    src={backgroundSrc}
                    alt={backgroundAlt}
                    onClick={backgroundSrc ? () => setModal({ src: backgroundSrc, alt: backgroundAlt }) : undefined}
                  />
                </div>

                {background.error && (
                  <div className="script-line" style={{ fontSize: 11, color: 'var(--danger, #f87171)' }}>
                    {background.error}
                  </div>
                )}

                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="retry-btn"
                    onClick={() => handleGenerateBackgroundPrompt(background.sceneId)}
                    disabled={
                      background.status === 'generating' ||
                      promptBusyBackgroundSceneId === background.sceneId ||
                      promptBusyBackgroundAll
                    }
                  >
                    {promptBusyBackgroundSceneId === background.sceneId ? '⏳ Đang sinh...' : '✨ Sinh prompt bằng AI'}
                  </button>
                  {background.status === 'generating' ? (
                    <button
                      className="retry-btn"
                      onClick={() => handleStopBackground(background.sceneId)}
                      disabled={busyBackgroundSceneId === background.sceneId}
                      title="Chỉ dừng theo dõi phía app, không hủy được ảnh đang render bên Google Flow"
                    >
                      ⏹ Dừng
                    </button>
                  ) : (
                    <button
                      className="retry-btn"
                      onClick={() => setPreviewTarget({ sceneId: background.sceneId, kind: 'background' })}
                      disabled={busyBackgroundSceneId === background.sceneId || busyBackgroundAll}
                    >
                      {background.status === 'failed' ? '🔄 Retry' : '▶ Gen'}
                    </button>
                  )}
                </div>
              </div>
              );
            })()}
          </div>
          );
        })}
      </div>

      {previewTarget &&
        (() => {
          const isBackground = previewTarget.kind === 'background';
          const promptText = (isBackground ? backgroundPrompts : prompts)[previewTarget.sceneId] ?? '';
          const refs: { path: string; url: string | null }[] = [];
          if (!isBackground) {
            if (project.storyboard.useProductReference) {
              const chosen =
                project.storyboard.productReferenceImagePath ||
                defaultProductReferenceImage(project.inputs.productImages);
              if (chosen) {
                const idx = project.inputs.productImages.indexOf(chosen);
                refs.push({ path: chosen, url: (idx >= 0 && project.inputs.productImageUrls?.[idx]) || null });
              }
            }
            if (project.storyboard.useSpokespersonReference && project.inputs.spokespersonImagePath) {
              refs.push({ path: project.inputs.spokespersonImagePath, url: project.inputs.spokespersonImageUrl });
            }
          }
          const refPaths = refs.map((r) => r.path);
          const isOmniRouteModel = project.storyboard.model.includes('/');
          const busy = isBackground
            ? busyBackgroundSceneId === previewTarget.sceneId
            : busySceneId === previewTarget.sceneId;

          return (
            <div className="media-modal-overlay" onClick={() => setPreviewTarget(null)}>
              <div className="media-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="card" style={{ width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}>
                  <div className="card-header">
                    👁️ Preview trước khi gen {isBackground ? 'background' : 'storyboard'}
                  </div>

                  <div className="field-group">
                    <label>Prompt sẽ gửi</label>
                    <div
                      style={{
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 10,
                        maxHeight: 180,
                        overflowY: 'auto',
                      }}
                    >
                      {promptText || '(chưa có prompt)'}
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Provider / model</label>
                    <div style={{ fontSize: 12 }}>{project.storyboard.model}</div>
                  </div>

                  <div className="field-group">
                    <label>Ảnh tham chiếu sẽ gửi kèm ({refPaths.length})</label>
                    {refPaths.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Không gửi ảnh nào — chỉ dùng prompt text.
                      </div>
                    ) : (
                      <div className="image-preview-grid">
                        {refs.map(({ path: p, url }) => {
                          const src = url || `/api/projects/${project.id}/media/${p}`;
                          return (
                            <img
                              key={p}
                              className="image-preview-thumb"
                              src={src}
                              alt="Ảnh tham chiếu"
                              style={{ cursor: 'zoom-in' }}
                              onClick={() => setModal({ src, alt: 'Ảnh tham chiếu' })}
                            />
                          );
                        })}
                      </div>
                    )}
                    {refPaths.length > 1 && isOmniRouteModel && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                        ℹ️ Provider OmniRoute chỉ nhận 1 ảnh tham chiếu — chỉ ảnh đầu tiên ở trên được gửi kèm.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button className="btn" onClick={() => setPreviewTarget(null)}>
                      Huỷ
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => {
                        const target = previewTarget;
                        setPreviewTarget(null);
                        if (isBackground) handleGenerateBackground(target.sceneId);
                        else handleGenerate(target.sceneId);
                      }}
                    >
                      ✅ Xác nhận Generate
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      {/* Render sau cùng để modal zoom luôn nổi trên preview khi bấm ảnh từ trong đó. */}
      {modal && <MediaModal kind="image" src={modal.src} alt={modal.alt} onClose={() => setModal(null)} />}
    </div>
  );
}
