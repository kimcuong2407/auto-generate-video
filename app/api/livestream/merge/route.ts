import { NextRequest, NextResponse } from 'next/server';
import { listMerges, createMerge } from '@/lib/livestream/mergeStore';
import { jobExists, readJob } from '@/lib/livestream/jobStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const merges = await listMerges();
  return NextResponse.json({ merges });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const jobSlugs = Array.isArray(body.jobSlugs) ? (body.jobSlugs as unknown[]).filter((s) => typeof s === 'string') as string[] : [];

  if (!name) {
    return NextResponse.json({ error: 'Thiếu tên video gộp' }, { status: 400 });
  }
  if (jobSlugs.length < 2) {
    return NextResponse.json({ error: 'Cần chọn ít nhất 2 job để gộp' }, { status: 400 });
  }

  for (const slug of jobSlugs) {
    if (!(await jobExists(slug))) {
      return NextResponse.json({ error: `Job không tồn tại: ${slug}` }, { status: 400 });
    }
  }

  const jobs = await Promise.all(jobSlugs.map((slug) => readJob(slug)));
  const notReady = jobs.filter((j) => j.concat.status !== 'done');
  if (notReady.length > 0) {
    return NextResponse.json(
      { error: `Job chưa "Ghép video" xong: ${notReady.map((j) => j.name).join(', ')}` },
      { status: 400 }
    );
  }
  const aspectRatio = jobs[0].aspectRatio;
  const mismatched = jobs.filter((j) => j.aspectRatio !== aspectRatio);
  if (mismatched.length > 0) {
    return NextResponse.json(
      {
        error: `Các job phải cùng tỉ lệ khung hình ${aspectRatio} — job lệch: ${mismatched
          .map((j) => `${j.name} (${j.aspectRatio})`)
          .join(', ')}`,
      },
      { status: 400 }
    );
  }

  const merge = await createMerge(name, jobSlugs);
  return NextResponse.json({ merge });
}
