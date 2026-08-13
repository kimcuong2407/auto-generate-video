'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/lib/types';

const POLL_INTERVAL_MS = 4500;

function isBusy(project: Project | null): boolean {
  if (!project) return false;
  const hasGenerating = project.script.scenes.some((s) => s.status === 'generating');
  const concatRunning = project.concat.status === 'running';
  return hasGenerating || concatRunning;
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

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (cancelled) return;
      await refresh();
      if (cancelled) return;
      timerRef.current = setTimeout(loop, POLL_INTERVAL_MS);
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
