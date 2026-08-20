/**
 * Store cho tính năng "gộp nhiều job livestream thành 1 video" — bảng đơn `livestream_merges`
 * (không cần cấu trúc 3 tầng job→product→segment như jobStore, vì merge chỉ là 1 list job slug
 * + 1 ConcatState). Mirror jobStore.ts (transaction + FOR UPDATE) nhưng đơn giản hơn nhiều.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { isoToSql, sqlToIso } from '../db/datetime';
import { generateJobSlug, assertValidJobId } from './paths';
import type { ConcatState } from '../types';
import type { LivestreamMerge, LivestreamMergeSummary } from './types';

const { livestreamMerges } = schema;

type MergeRow = typeof livestreamMerges.$inferSelect;

function assembleMerge(row: MergeRow): LivestreamMerge {
  return {
    id: row.slug,
    slug: row.slug,
    name: row.name,
    createdAt: sqlToIso(row.createdAt) ?? row.createdAt,
    updatedAt: sqlToIso(row.updatedAt) ?? row.updatedAt,
    jobSlugs: row.jobSlugs,
    concat: row.concat,
  };
}

export function idleConcatState(): ConcatState {
  return {
    status: 'idle',
    log: [],
    outputPath: null,
    outputUrl: null,
    outputMeta: null,
    error: null,
    startedAt: null,
    finishedAt: null,
  };
}

export async function createMerge(name: string, jobSlugs: string[]): Promise<LivestreamMerge> {
  const slug = generateJobSlug(name);
  const now = new Date().toISOString();
  const merge: LivestreamMerge = {
    id: slug,
    slug,
    name,
    createdAt: now,
    updatedAt: now,
    jobSlugs,
    concat: idleConcatState(),
  };
  const db = getDb();
  await db.insert(livestreamMerges).values({
    slug: merge.slug,
    name: merge.name,
    createdAt: isoToSql(merge.createdAt)!,
    updatedAt: isoToSql(merge.updatedAt)!,
    jobSlugs: merge.jobSlugs,
    concat: merge.concat,
  });
  return merge;
}

export async function mergeExists(id: string): Promise<boolean> {
  try {
    assertValidJobId(id);
  } catch {
    return false;
  }
  const db = getDb();
  const rows = await db
    .select({ id: livestreamMerges.id })
    .from(livestreamMerges)
    .where(eq(livestreamMerges.slug, id))
    .limit(1);
  return rows.length > 0;
}

export async function readMerge(id: string): Promise<LivestreamMerge> {
  assertValidJobId(id);
  const db = getDb();
  const rows = await db.select().from(livestreamMerges).where(eq(livestreamMerges.slug, id)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`Merge không tồn tại: ${id}`);
  return assembleMerge(row);
}

/** Đọc → sửa → ghi nguyên tử (SELECT ... FOR UPDATE) — mirror updateJob ở jobStore.ts. */
export async function updateMerge<T = void>(
  id: string,
  mutator: (merge: LivestreamMerge) => T | Promise<T>
): Promise<{ merge: LivestreamMerge; result: T }> {
  assertValidJobId(id);
  const db = getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(livestreamMerges)
      .where(eq(livestreamMerges.slug, id))
      .for('update')
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Merge không tồn tại: ${id}`);
    const merge = assembleMerge(row);

    const result = await mutator(merge);
    merge.updatedAt = new Date().toISOString();
    await tx
      .update(livestreamMerges)
      .set({
        name: merge.name,
        updatedAt: isoToSql(merge.updatedAt)!,
        jobSlugs: merge.jobSlugs,
        concat: merge.concat,
      })
      .where(eq(livestreamMerges.id, row.id));
    return { merge, result };
  });
}

export async function listMerges(): Promise<LivestreamMergeSummary[]> {
  const db = getDb();
  const rows = await db.select().from(livestreamMerges);
  const summaries: LivestreamMergeSummary[] = rows.map((r) => ({
    id: r.slug,
    name: r.name,
    updatedAt: sqlToIso(r.updatedAt) ?? r.updatedAt,
    status: r.concat.status,
    jobCount: r.jobSlugs.length,
  }));
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return summaries;
}

export async function deleteMerge(id: string): Promise<void> {
  assertValidJobId(id);
  const db = getDb();
  await db.delete(livestreamMerges).where(eq(livestreamMerges.slug, id));
}
