'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LivestreamJob } from '@/lib/livestream/types';

const POLL_INTERVAL_MS = 4500;

function isBusy(job: LivestreamJob | null): boolean {
  if (!job) return false;
  const hasGenerating = job.products.some((p) => p.segments.some((s) => s.status === 'generating'));
  const concatRunning = job.concat.status === 'running';
  return hasGenerating || concatRunning;
}

export function useLivestreamPolling(jobId: string) {
  const [job, setJob] = useState<LivestreamJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/livestream/${jobId}/status`, { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { job: LivestreamJob };
      setJob(data.job);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

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

  const mutate = useCallback((updater: (j: LivestreamJob) => LivestreamJob) => {
    setJob((prev) => (prev ? updater(prev) : prev));
  }, []);

  return { job, loading, error, refresh, mutate, busy: isBusy(job) };
}
