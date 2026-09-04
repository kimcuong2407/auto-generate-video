import { NextRequest, NextResponse } from 'next/server';
import { generateJobSlug, jobInputsDir } from '@/lib/livestream/paths';
import { createJobDirs, listJobs, writeJob } from '@/lib/livestream/jobStore';
import { createNewJob } from '@/lib/livestream/jobFactory';
import { resolveFlowProjectIdSafe } from '@/lib/googleFlow/flowJobs';
import { ingestEntry, type EntryInput } from '@/lib/livestream/ingestEntry';
import { uploadImageToR2 } from '@/lib/livestream/imageR2';
import { runWithConcurrency } from '@/lib/concurrency';
import { INGEST_CONCURRENCY } from '@/lib/livestream/constants';
import { filterV2JobSlugs, writeV2Input } from '@/lib/livestream/v2Store';
import { claimAiCallLogs } from '@/lib/ai/callLog';
import type { LivestreamChaining, LivestreamV2Input } from '@/lib/livestream/types';
import type { VeoModel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `?variant=v2` trả job của tab Livestream V2, mặc định trả job V1. Hai tab dùng chung bảng job
 * nên phải lọc, nếu không mỗi tab hiện luôn cả job của tab kia.
 */
export async function GET(req: NextRequest) {
  const jobs = await listJobs();
  const wantV2 = req.nextUrl.searchParams.get('variant') === 'v2';
  const v2Slugs = await filterV2JobSlugs(jobs.map((j) => j.id));
  return NextResponse.json({ jobs: jobs.filter((j) => v2Slugs.has(j.id) === wantV2) });
}

export async function POST(req: NextRequest) {
  try {
    return await createJob(req);
  } catch (err) {
    // Trước đây exception ở đây rơi thẳng ra ngoài thành 500 body RỖNG, client chỉ thấy
    // "Tạo job thất bại (HTTP 500)" — không đủ để biết hỏng ở bước nào. Log đầy đủ ở server và
    // trả message thật về client: route này chỉ Mr.D dùng, giấu nguyên nhân không được lợi gì.
    console.error('[livestream] tạo job thất bại:', err);
    // Drizzle bọc lỗi DB thật vào `cause` — message ngoài chỉ là câu query, không nói lý do.
    const cause = (err as { cause?: Error }).cause;
    if (cause) console.error('[livestream] nguyên nhân gốc:', cause.message);
    return NextResponse.json(
      {
        error: `Tạo job thất bại: ${((err as { cause?: Error }).cause ?? (err as Error)).message}`,
      },
      { status: 500 }
    );
  }
}

async function createJob(req: NextRequest) {
  const form = await req.formData();

  const name = String(form.get('name') || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Thiếu tên job' }, { status: 400 });
  }

  const aspectRatio = (String(form.get('aspectRatio') || '9:16') === '16:9' ? '16:9' : '9:16') as
    | '9:16'
    | '16:9';
  const veoModel = (String(form.get('veoModel') || 'veo_3_1_fast')) as VeoModel;
  const chainingRaw = String(form.get('chaining') || 'continuous');
  const chaining: LivestreamChaining =
    chainingRaw === 'off' || chainingRaw === 'per_product' ? chainingRaw : 'continuous';

  let entries: EntryInput[];
  try {
    entries = JSON.parse(String(form.get('entries') || '[]'));
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('Cần ít nhất 1 sản phẩm (link/file/nhập tay)');
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Danh sách sản phẩm (entries) không hợp lệ: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const slug = generateJobSlug(name);
  await createJobDirs(slug);
  const inputsDir = jobInputsDir(slug);

  const results = await runWithConcurrency(entries, INGEST_CONCURRENCY, (entry, index) =>
    ingestEntry(entry, form, inputsDir, index, slug)
  );

  const products = results.flatMap((r) => r.products);
  const warnings = results.flatMap((r) => r.warnings);
  products.forEach((p, i) => {
    p.order = i + 1;
  });

  if (products.length === 0) {
    return NextResponse.json(
      { error: 'Không tạo được sản phẩm nào từ dữ liệu đã gửi', warnings },
      { status: 400 }
    );
  }

  const job = createNewJob({ slug, name, aspectRatio, veoModel, chaining, products });
  // Gom ảnh sản phẩm crawl/upload từ mọi entry vào BỘ ẢNH CHUNG cấp job (không gắn theo product).
  const allImagePaths = results.flatMap((r) => r.imagePaths ?? []);
  if (allImagePaths.length > 0) {
    job.spokespersonImagePaths = allImagePaths;
    // Đẩy ngay lên R2 (best-effort) để không mất khi deploy — cùng pattern route images/spokesperson.
    for (const rel of allImagePaths) {
      job.imageR2Urls[rel] = await uploadImageToR2(slug, rel);
    }
  }
  // Gán sẵn flowProjectId ngay khi tạo — xem giải thích tương ứng ở app/api/projects/route.ts.
  job.flowProjectId = await resolveFlowProjectIdSafe(name);
  await writeJob(job);

  // Form gửi kèm `v2Input` = tạo job cho tab Livestream V2: ghi bản ghi input Shopee NGAY trong
  // lượt tạo. Ghi ở đây (không để client PUT riêng sau) vì nếu lượt PUT đó lỗi, job sẽ nằm lại ở
  // tab V1 với prompt V1 — sai tab và sai cả kịch bản, rất khó nhận ra.
  const v2Raw = String(form.get('v2Input') || '').trim();
  if (v2Raw) {
    try {
      await writeV2Input(slug, JSON.parse(v2Raw) as LivestreamV2Input);
    } catch (err) {
      warnings.push(`Không lưu được thông tin buổi live V2: ${(err as Error).message}`);
    }
  }

  // Gán các lượt AI đã chạy TRƯỚC khi có job (bóc tách form Shopee ở trang crawl) về cho job này,
  // để Mr.D xem lại input/output của "bước trước đó" ngay trong job detail. Chỉ nhận rowId đích
  // danh client gửi kèm — xem claimAiCallLogs(). Best-effort, không chặn tạo job.
  const claimRaw = String(form.get('aiLogRowIds') || '').trim();
  if (claimRaw) {
    try {
      const ids = (JSON.parse(claimRaw) as unknown[])
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0);
      await claimAiCallLogs(slug, ids);
    } catch (err) {
      // Không đẩy vào warnings: đây là dấu vết để soát chất lượng, hỏng không ảnh hưởng job.
      console.error(`[livestream] gán log AI cho job ${slug} thất bại: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ id: slug, job, warnings }, { status: 201 });
}
