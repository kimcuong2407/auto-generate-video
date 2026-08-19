import { NextRequest, NextResponse } from 'next/server';
import { generateJobSlug, jobInputsDir } from '@/lib/livestream/paths';
import { createJobDirs, listJobs, writeJob } from '@/lib/livestream/jobStore';
import { createNewJob } from '@/lib/livestream/jobFactory';
import { resolveFlowProjectIdSafe } from '@/lib/googleFlow/flowJobs';
import { ingestEntry, type EntryInput } from '@/lib/livestream/ingestEntry';
import { uploadImageToR2 } from '@/lib/livestream/imageR2';
import { runWithConcurrency } from '@/lib/concurrency';
import { INGEST_CONCURRENCY } from '@/lib/livestream/constants';
import type { LivestreamChaining } from '@/lib/livestream/types';
import type { VeoModel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
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
    ingestEntry(entry, form, inputsDir, index)
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

  return NextResponse.json({ id: slug, job, warnings }, { status: 201 });
}
