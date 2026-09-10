'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/lib/types';

const POLL_INTERVAL_MS = 4500;
/**
 * Nhịp poll khi có việc đang chạy. Nhanh hơn để thanh tiến độ ở Bước 3/4 bám sát thực tế — 1 ảnh
 * storyboard thường xong trong ~20-40s, poll 4.5s là thấy trạng thái trễ tới cả chục giây.
 * Chỉ nhanh lúc đang chạy: lúc rảnh mà poll 2s là 30 request/phút cho một trang đứng yên.
 */
const POLL_INTERVAL_BUSY_MS = 2000;

/**
 * Project có việc đang chạy nền không.
 *
 * Tính CẢ ảnh storyboard/background (Bước 3), không chỉ video (Bước 4): loạt gen ảnh chạy hàng
 * phút và route chỉ trả lời khi xong cả loạt, nên đây đúng là lúc cần poll dày nhất. Bỏ sót hai
 * mảng này khiến thanh tiến độ Bước 3 nhảy giật từng nấc 4.5 giây.
 */
function isBusy(project: Project | null): boolean {
  if (!project) return false;
  const hasGenerating = project.script.scenes.some((s) => s.status === 'generating');
  const imagesGenerating =
    project.storyboard.images.some((i) => i.status === 'generating') ||
    project.storyboard.backgrounds.some((i) => i.status === 'generating');
  const concatRunning = project.concat.status === 'running';
  return hasGenerating || imagesGenerating || concatRunning;
}

export function useProjectPolling(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/status`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { project: Project };
      setProject(data.project);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Nhịp poll đọc qua ref: `loop` tự hẹn giờ cho lượt kế nên nếu đọc `busy` từ closure, nó sẽ
  // kẹt mãi ở giá trị lúc effect chạy lần đầu (luôn là false — chưa có project). Ref cho phép
  // lượt sau đọc giá trị mới nhất mà không phải dựng lại vòng lặp.
  const busyRef = useRef(false);
  busyRef.current = isBusy(project);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timerRef.current = setTimeout(loop, busyRef.current ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_MS);
    }

    loop();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  // Optimistic local mutation trước khi lần poll kế tiếp tới
  const mutate = useCallback((updater: (p: Project) => Project) => {
    setProject((prev) => (prev ? updater(prev) : prev));
  }, []);

  return { project, loading, error, refresh, mutate, busy: isBusy(project) };
}
