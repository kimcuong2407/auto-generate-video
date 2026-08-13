import { NextRequest, NextResponse } from 'next/server';
import { generateJobId, jobInputsDir } from '@/lib/livestream/paths';
import { createJobDirs, listJobs, writeJob } from '@/lib/livestream/jobStore';
import { createNewJob } from '@/lib/livestream/jobFactory';
import { ingestEntry, type EntryInput } from '@/lib/livestream/ingestEntry';
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

  const id = generateJobId(name);
  await createJobDirs(id);
  const inputsDir = jobInputsDir(id);

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

  const job = createNewJob({ id, name, aspectRatio, veoModel, chaining, products });
  await writeJob(job);

  return NextResponse.json({ id, job, warnings }, { status: 201 });
}
