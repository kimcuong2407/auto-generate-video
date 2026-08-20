import { NextRequest, NextResponse } from 'next/server';
import { mergeExists } from '@/lib/livestream/mergeStore';
import { resolveWithinMerge } from '@/lib/livestream/paths';
import { streamFileResponse } from '@/lib/streamFile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; path: string[] } }
) {
  const { id, path: pathSegments } = params;
  if (!(await mergeExists(id))) {
    return NextResponse.json({ error: 'Merge không tồn tại' }, { status: 404 });
  }

  let absPath: string;
  try {
    absPath = resolveWithinMerge(id, pathSegments.join('/'));
  } catch {
    return NextResponse.json({ error: 'Đường dẫn không hợp lệ' }, { status: 403 });
  }

  return streamFileResponse(req, absPath);
}
