import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { mergeExists, readMerge, deleteMerge } from '@/lib/livestream/mergeStore';
import { mergeDir } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await mergeExists(params.id))) {
    return NextResponse.json({ error: 'Merge không tồn tại' }, { status: 404 });
  }
  const merge = await readMerge(params.id);
  return NextResponse.json({ merge });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await mergeExists(id))) {
    return NextResponse.json({ error: 'Merge không tồn tại' }, { status: 404 });
  }
  const merge = await readMerge(id);
  if (merge.concat.status === 'running') {
    return NextResponse.json({ error: 'Đang ghép, chưa thể xoá' }, { status: 409 });
  }
  await deleteMerge(id);
  await fs.rm(mergeDir(id), { recursive: true, force: true });
  return NextResponse.json({ ok: true });
}
