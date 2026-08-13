'use client';

import { useCallback, useRef, useState } from 'react';
import type { Project } from '@/lib/types';
import { runScriptGenerateSSE } from '@/lib/client/scriptGenerate';

export type PipelineStepKey = 'script' | 'storyboard' | 'video' | 'concat';
export type PipelineStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface PipelineStepInfo {
  key: PipelineStepKey;
  label: string;
  status: PipelineStepStatus;
  message?: string;
}

const STEP_DEFS: { key: PipelineStepKey; label: string }[] = [
  { key: 'script', label: 'Bước 2 · Kịch bản' },
  { key: 'storyboard', label: 'Bước 3 · Storyboard' },
  { key: 'video', label: 'Bước 4 · Video' },
  { key: 'concat', label: 'Bước 6 · Ghép video' },
];

class PipelineCancelledError extends Error {
  constructor() {
    super('Đã dừng theo yêu cầu');
  }
}

function initialSteps(): PipelineStepInfo[] {
  return STEP_DEFS.map((s) => ({ ...s, status: 'pending' as PipelineStepStatus }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${projectId}/status`, { cache: 'no-store' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { project: Project };
  return data.project;
}

async function postJson(url: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
}

/**
 * Orchestrator chạy nối tiếp Bước 2 (kịch bản) → 3 (storyboard) → 4 (video) → 6 (ghép video)
 * cho 1 project, bỏ qua bước nào đã xong sẵn. Bước 4/6 dùng API fire-and-forget nên phải tự
 * poll GET /status (độc lập với useProjectPolling ở trang chi tiết) cho tới khi ổn định.
 */
export function useAutoPipeline(projectId: string, onRefresh: () => Promise<void>) {
  const [steps, setSteps] = useState<PipelineStepInfo[] | null>(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  const updateStep = useCallback((key: PipelineStepKey, patch: Partial<PipelineStepInfo>) => {
    setSteps((prev) => (prev ? prev.map((s) => (s.key === key ? { ...s, ...patch } : s)) : prev));
  }, []);

  const checkCancelled = useCallback(() => {
    if (cancelRef.current) throw new PipelineCancelledError();
  }, []);

  const waitUntil = useCallback(
    async (predicate: (p: Project) => boolean, intervalMs: number, timeoutMs: number): Promise<Project> => {
      const start = Date.now();
      while (true) {
        checkCancelled();
        const p = await fetchLatestProject(projectId);
        if (predicate(p)) return p;
        if (Date.now() - start > timeoutMs) {
          throw new Error('Quá thời gian chờ, vui lòng kiểm tra lại thủ công');
        }
        await sleep(intervalMs);
      }
    },
    [projectId, checkCancelled]
  );

  const run = useCallback(async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setSteps(initialSteps());

    try {
      let current = await fetchLatestProject(projectId);

      // Bước 2 — Kịch bản
      updateStep('script', { status: 'running' });
      checkCancelled();
      const hasAllPrompts =
        current.script.scenes.length > 0 && current.script.scenes.every((s) => s.veoPrompt.trim().length > 0);
      if (hasAllPrompts) {
        updateStep('script', { status: 'skipped', message: 'Đã có prompt' });
      } else if (!current.scriptAngleId) {
        updateStep('script', {
          status: 'error',
          message: 'Cần chọn góc kịch bản ở Bước 2 trước khi chạy tự động',
        });
        return;
      } else {
        await runScriptGenerateSSE(projectId, current.scriptAngleId);
        current = await fetchLatestProject(projectId);
        updateStep('script', { status: 'done' });
      }
      checkCancelled();

      // Bước 3 — Storyboard (không đụng tới ảnh background — chỉ phụ trợ, không bắt buộc cho Bước 4)
      updateStep('storyboard', { status: 'running' });
      const allStoryboardDone =
        current.storyboard.images.length > 0 && current.storyboard.images.every((img) => img.status === 'done');
      if (allStoryboardDone) {
        updateStep('storyboard', { status: 'skipped', message: 'Đã xong' });
      } else {
        const missingPrompt = current.storyboard.images.some((img) => !img.prompt.trim());
        if (missingPrompt) {
          await postJson(`/api/projects/${projectId}/storyboard/generate-prompts`);
          checkCancelled();
        }
        await postJson(`/api/projects/${projectId}/storyboard/generate-all`);
        current = await fetchLatestProject(projectId);
        const failedImages = current.storyboard.images.filter((img) => img.status === 'failed');
        if (failedImages.length > 0) {
          updateStep('storyboard', { status: 'error', message: `${failedImages.length} ảnh lỗi` });
          return;
        }
        updateStep('storyboard', { status: 'done' });
      }
      checkCancelled();

      // Bước 4 — Video
      updateStep('video', { status: 'running' });
      const allVideoDone =
        current.script.scenes.length > 0 && current.script.scenes.every((s) => s.status === 'done');
      if (allVideoDone) {
        updateStep('video', { status: 'skipped', message: 'Đã xong' });
      } else {
        await postJson(`/api/projects/${projectId}/scenes/generate-all`);
        current = await waitUntil(
          (p) => p.script.scenes.every((s) => s.status !== 'generating'),
          4000,
          45 * 60 * 1000
        );
        const notDone = current.script.scenes.filter((s) => s.status !== 'done');
        if (notDone.length > 0) {
          updateStep('video', {
            status: 'error',
            message: `${notDone.length} cảnh chưa xong (lỗi hoặc bị chặn chain)`,
          });
          return;
        }
        updateStep('video', { status: 'done' });
      }
      checkCancelled();

      // Bước 6 — Ghép video
      updateStep('concat', { status: 'running' });
      if (current.concat.status === 'done') {
        updateStep('concat', { status: 'skipped', message: 'Đã xong' });
      } else {
        await postJson(`/api/projects/${projectId}/concat`, {});
        current = await waitUntil((p) => p.concat.status !== 'running', 3000, 10 * 60 * 1000);
        if (current.concat.status !== 'done') {
          updateStep('concat', { status: 'error', message: current.concat.error || 'Ghép video thất bại' });
          return;
        }
        updateStep('concat', { status: 'done' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSteps((prev) => {
        if (!prev) return prev;
        const runningIdx = prev.findIndex((s) => s.status === 'running');
        if (runningIdx === -1) return prev;
        const next = [...prev];
        next[runningIdx] = { ...next[runningIdx], status: 'error', message };
        return next;
      });
    } finally {
      setRunning(false);
      await onRefresh();
    }
  }, [projectId, running, updateStep, checkCancelled, waitUntil, onRefresh]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const dismiss = useCallback(() => {
    setSteps((prev) => (running ? prev : null));
  }, [running]);

  return { steps, running, run, cancel, dismiss };
}
