/**
 * Store cho input Shopee của job V2 (bảng livestream_v2_inputs, 1 row / job).
 *
 * Job V2 KHÔNG có bộ bảng riêng: nó là 1 LivestreamJob bình thường (dùng chung jobStore, ảnh,
 * segment, Veo, ghép video) cộng thêm 1 row input ở đây. Có row = job V2, không có = job V1.
 * Xem docs/shopee-livestream-script-generator-SKILL.md.
 */
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { isoToSql } from '../db/datetime';
import { assertValidJobId } from './paths';
import type { LivestreamV2Input } from './types';

const { livestreamJobs, livestreamV2Inputs } = schema;

export const DEFAULT_V2_INPUT: LivestreamV2Input = {
  advantages: [],
  platform: 'Shopee Live',
  channelName: '',
  followerCount: '',
  viewerCount: '',
  promotion: '',
  cta: '',
  dialoguesPerScene: 3,
};

/** rowId thật của job từ slug — bảng V2 khoá theo PK bigint như products/segments. */
async function jobRowId(jobSlug: string): Promise<number | null> {
  assertValidJobId(jobSlug);
  const rows = await getDb()
    .select({ id: livestreamJobs.id })
    .from(livestreamJobs)
    .where(eq(livestreamJobs.slug, jobSlug))
    .limit(1);
  return rows[0]?.id ?? null;
}

function toInput(row: typeof livestreamV2Inputs.$inferSelect): LivestreamV2Input {
  return {
    advantages: row.advantages ?? [],
    platform: row.platform,
    channelName: row.channelName,
    followerCount: row.followerCount,
    viewerCount: row.viewerCount,
    promotion: row.promotion,
    cta: row.cta,
    dialoguesPerScene: row.dialoguesPerScene,
  };
}

/** Input V2 của 1 job; null = job V1 (không có bản ghi). */
export async function readV2Input(jobSlug: string): Promise<LivestreamV2Input | null> {
  const id = await jobRowId(jobSlug);
  if (id == null) return null;
  const rows = await getDb()
    .select()
    .from(livestreamV2Inputs)
    .where(eq(livestreamV2Inputs.jobId, id))
    .limit(1);
  return rows[0] ? toInput(rows[0]) : null;
}

/** Ghi (insert hoặc update) input V2 — đánh dấu job này là job V2. */
export async function writeV2Input(jobSlug: string, input: LivestreamV2Input): Promise<void> {
  const id = await jobRowId(jobSlug);
  if (id == null) throw new Error(`Livestream job không tồn tại: ${jobSlug}`);
  const now = isoToSql(new Date().toISOString())!;
  const values = {
    jobId: id,
    platform: input.platform,
    channelName: input.channelName,
    followerCount: input.followerCount,
    viewerCount: input.viewerCount,
    promotion: input.promotion,
    cta: input.cta,
    advantages: input.advantages,
    dialoguesPerScene: input.dialoguesPerScene,
    createdAt: now,
    updatedAt: now,
  };
  await getDb()
    .insert(livestreamV2Inputs)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        platform: values.platform,
        channelName: values.channelName,
        followerCount: values.followerCount,
        viewerCount: values.viewerCount,
        promotion: values.promotion,
        cta: values.cta,
        advantages: values.advantages,
        dialoguesPerScene: values.dialoguesPerScene,
        updatedAt: now,
      },
    });
}

/**
 * Lọc ra các slug là job V2 trong danh sách cho trước — dùng để tab V2 chỉ liệt kê job của nó
 * (và tab V1 loại chúng ra), tránh 2 tab hiện lẫn job của nhau.
 */
export async function filterV2JobSlugs(jobSlugs: string[]): Promise<Set<string>> {
  if (jobSlugs.length === 0) return new Set();
  const rows = await getDb()
    .select({ slug: livestreamJobs.slug })
    .from(livestreamV2Inputs)
    .innerJoin(livestreamJobs, eq(livestreamJobs.id, livestreamV2Inputs.jobId))
    .where(inArray(livestreamJobs.slug, jobSlugs));
  return new Set(rows.map((r) => r.slug));
}
