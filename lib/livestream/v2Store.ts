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

/**
 * Cache nhãn V1/V2 theo slug, phạm vi 1 process.
 *
 * Nhãn này gần như bất biến sau khi job được tạo (row V2 ghi lúc tạo job, không đường nào xoá),
 * còn bước sinh kịch bản gọi log 3 lần cho MỖI sản phẩm — job 32 sản phẩm là ~96 truy vấn cho
 * một giá trị tĩnh. writeV2Input cập nhật cache để ca "tạo job V1 rồi ghi input V2 ngay sau đó"
 * không kẹt nhãn cũ.
 */
const kindCache = new Map<string, LivestreamKind>();

export type LivestreamKind = 'livestream-v1' | 'livestream-v2';

/**
 * Job này thuộc luồng V1 hay V2 — dùng để gắn `source_kind` cho log.
 *
 * KHÔNG DÙNG ĐƯỢC ở các bước chạy lúc TẠO job (extract / vision_screenshot): thời điểm đó row
 * livestream_v2_inputs CHƯA được ghi nên hàm này trả 'livestream-v1' cho cả job V2. Ở những chỗ
 * đó phải truyền nhãn từ route xuống — xem lib/livestream/ingestEntry.ts.
 *
 * KHÔNG NÉM: log là phụ trợ. DB lỗi thì trả 'livestream-v1' + ghi console, chứ để nó làm fail một
 * lượt gen là đổi quan sát lấy hồi quy thật (cùng nguyên tắc recordAiCall).
 */
export async function resolveLivestreamKind(jobSlug: string): Promise<LivestreamKind> {
  const cached = kindCache.get(jobSlug);
  if (cached) return cached;
  try {
    const kind: LivestreamKind = (await readV2Input(jobSlug)) ? 'livestream-v2' : 'livestream-v1';
    kindCache.set(jobSlug, kind);
    return kind;
  } catch (err) {
    // KHÔNG cache khi lỗi: vòng sau DB khoẻ lại thì phải tra được nhãn đúng.
    console.error(`[v2Store] không xác định được loại job ${jobSlug}: ${(err as Error).message}`);
    return 'livestream-v1';
  }
}

/** Ghi (insert hoặc update) input V2 — đánh dấu job này là job V2. */
export async function writeV2Input(jobSlug: string, input: LivestreamV2Input): Promise<void> {
  const id = await jobRowId(jobSlug);
  if (id == null) throw new Error(`Livestream job không tồn tại: ${jobSlug}`);
  // Job vừa được đánh dấu V2 — nếu trước đó có ai gọi resolveLivestreamKind (khi row chưa tồn
  // tại) thì cache đang giữ 'livestream-v1' và sẽ gắn sai nhãn cho mọi log về sau của job này.
  kindCache.set(jobSlug, 'livestream-v2');
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
