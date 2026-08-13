import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIVESTREAM_DATA_ROOT } from './constants';
import { jobDir, jobJsonPath, assertValidJobId } from './paths';
import type { LivestreamJob, LivestreamJobSummary } from './types';

// Chain các thao tác đọc-sửa-ghi trên cùng 1 job-id để tránh lost-update
// khi nhiều request (poll, generate, patch product...) chồng nhau — cùng cơ chế
// writeQueues theo id đang dùng cho project ở lib/data/projectStore.ts.
const writeQueues = new Map<string, Promise<void>>();

function enqueue<T>(jobId: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(jobId) || Promise.resolve();
  const result = prev.then(task, task);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  writeQueues.set(jobId, settled);
  return result;
}

export async function readJob(jobId: string): Promise<LivestreamJob> {
  assertValidJobId(jobId);
  const raw = await fs.readFile(jobJsonPath(jobId), 'utf-8');
  const job = JSON.parse(raw) as LivestreamJob;
  for (const product of job.products || []) {
    if (product.sourceFilePath === undefined) product.sourceFilePath = null;
    for (const segment of product.segments || []) {
      if (segment.lastFramePath === undefined) segment.lastFramePath = null;
    }
  }
  return job;
}

export function jobExists(jobId: string): boolean {
  try {
    assertValidJobId(jobId);
  } catch {
    return false;
  }
  return existsSync(jobJsonPath(jobId));
}

async function writeJobRaw(job: LivestreamJob): Promise<void> {
  job.updatedAt = new Date().toISOString();
  const jsonPath = jobJsonPath(job.id);
  const tmpPath = `${jsonPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(job, null, 2), 'utf-8');
  await fs.rename(tmpPath, jsonPath);
}

export async function writeJob(job: LivestreamJob): Promise<void> {
  return enqueue(job.id, () => writeJobRaw(job));
}

/** Đọc → sửa → ghi trong 1 thao tác nguyên tử (theo hàng đợi của job-id đó). */
export async function updateJob<T = void>(
  jobId: string,
  mutator: (job: LivestreamJob) => T | Promise<T>
): Promise<{ job: LivestreamJob; result: T }> {
  return enqueue(jobId, async () => {
    const job = await readJob(jobId);
    const result = await mutator(job);
    await writeJobRaw(job);
    return { job, result };
  });
}

export async function ensureLivestreamDataRoot(): Promise<void> {
  await fs.mkdir(LIVESTREAM_DATA_ROOT, { recursive: true });
}

export async function listJobs(): Promise<LivestreamJobSummary[]> {
  await ensureLivestreamDataRoot();
  const entries = await fs.readdir(LIVESTREAM_DATA_ROOT, { withFileTypes: true });
  const summaries: LivestreamJobSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const job = await readJob(entry.name);
      summaries.push({
        id: job.id,
        name: job.name,
        updatedAt: job.updatedAt,
        status: job.status,
        productCount: job.products.length,
      });
    } catch {
      // bỏ qua thư mục hỏng/không phải job hợp lệ
    }
  }
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return summaries;
}

export async function createJobDirs(jobId: string): Promise<void> {
  const dir = jobDir(jobId);
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'segments'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'frames'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'tmp'), { recursive: true });
}
