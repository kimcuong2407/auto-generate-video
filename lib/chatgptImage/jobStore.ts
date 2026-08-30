/**
 * Queue gen ảnh ChatGPT trên bảng chatgpt_image_jobs.
 *
 * Vì sao có queue thật thay vì gọi thẳng: 1 lượt gen mất tới vài phút và PM2 reload mỗi lần
 * deploy. Không có bảng thì job đang chạy biến mất không dấu vết — không biết cái nào dở để
 * dọn, không đếm được `attempts`. Có bảng thì trạng thái sống sót qua restart.
 */

import crypto from 'node:crypto';
import { and, asc, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { chatgptImageJobs } from '../db/schema';
import { isoToSql } from '../db/datetime';

export interface ChatgptImageJobInput {
  prompt: string;
  aspect: '9:16' | '16:9';
  refImagePaths?: string[];
}

export type ChatgptImageJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ChatgptImageJob {
  id: string;
  prompt: string;
  aspect: '9:16' | '16:9';
  refImagePaths: string[];
  status: ChatgptImageJobStatus;
  imagePath: string | null;
  error: string | null;
  attempts: number;
}

function nowSql(): string {
  return isoToSql(new Date().toISOString())!;
}

export async function createJob(input: ChatgptImageJobInput): Promise<string> {
  const id = `cgimg-${crypto.randomBytes(6).toString('hex')}`;
  const now = nowSql();
  await getDb().insert(chatgptImageJobs).values({
    id,
    prompt: input.prompt,
    aspect: input.aspect,
    refImagePaths: input.refImagePaths || [],
    status: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function readJob(id: string): Promise<ChatgptImageJob | null> {
  const rows = await getDb().select().from(chatgptImageJobs).where(eq(chatgptImageJobs.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    aspect: row.aspect,
    refImagePaths: row.refImagePaths || [],
    status: row.status,
    imagePath: row.imagePath,
    error: row.error,
    attempts: row.attempts,
  };
}

/**
 * Giành 1 job queued cho worker. UPDATE có điều kiện `status='queued'` là chốt chặn: 2 worker
 * cùng đọc ra 1 job thì chỉ đúng 1 cái UPDATE ăn dòng, cái còn lại thấy affectedRows=0 và bỏ
 * qua. Không cần transaction tường minh — chính câu UPDATE này đã atomic.
 */
export async function claimNextJob(accountId: string): Promise<ChatgptImageJob | null> {
  const db = getDb();
  const candidates = await db
    .select({ id: chatgptImageJobs.id })
    .from(chatgptImageJobs)
    .where(eq(chatgptImageJobs.status, 'queued'))
    .orderBy(asc(chatgptImageJobs.createdAt))
    .limit(5);

  for (const { id } of candidates) {
    const now = nowSql();
    const res = await db
      .update(chatgptImageJobs)
      .set({ status: 'running', accountId, startedAt: now, updatedAt: now })
      .where(and(eq(chatgptImageJobs.id, id), eq(chatgptImageJobs.status, 'queued')));
    // mysql2 trả affectedRows trong phần tử đầu của kết quả.
    const affected = (res as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0;
    if (affected > 0) {
      await db
        .update(chatgptImageJobs)
        .set({ attempts: (await readJob(id))!.attempts + 1 })
        .where(eq(chatgptImageJobs.id, id));
      return readJob(id);
    }
  }
  return null;
}

export async function finishJob(id: string, imagePath: string): Promise<void> {
  const now = nowSql();
  await getDb()
    .update(chatgptImageJobs)
    .set({ status: 'done', imagePath, error: null, finishedAt: now, updatedAt: now })
    .where(eq(chatgptImageJobs.id, id));
}

export async function failJob(id: string, error: string): Promise<void> {
  const now = nowSql();
  await getDb()
    .update(chatgptImageJobs)
    .set({ status: 'failed', error: error.slice(0, 2000), finishedAt: now, updatedAt: now })
    .where(eq(chatgptImageJobs.id, id));
}

/**
 * Dọn job kẹt 'running' quá lâu — luôn là dấu vết của PM2 reload giữa lúc gen (deploy), vì
 * worker chạy được thì tự finish/fail. Không dọn thì job nằm 'running' vĩnh viễn và call-site
 * chờ nó sẽ treo tới hết timeout của chính nó.
 */
export async function reapStaleJobs(maxAgeMs: number): Promise<number> {
  const cutoff = isoToSql(new Date(Date.now() - maxAgeMs).toISOString())!;
  const stale = await getDb()
    .select({ id: chatgptImageJobs.id })
    .from(chatgptImageJobs)
    .where(and(eq(chatgptImageJobs.status, 'running'), lt(chatgptImageJobs.startedAt, cutoff)));
  for (const { id } of stale) {
    await failJob(id, 'Job bị bỏ dở (server khởi động lại giữa lúc gen)');
  }
  return stale.length;
}
