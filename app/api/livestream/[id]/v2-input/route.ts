import { NextRequest, NextResponse } from 'next/server';
import { jobExists } from '@/lib/livestream/jobStore';
import { DEFAULT_V2_INPUT, readV2Input, writeV2Input } from '@/lib/livestream/v2Store';
import type { LivestreamV2Input } from '@/lib/livestream/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await jobExists(params.id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  return NextResponse.json({ input: await readV2Input(params.id) });
}

/** Chuẩn hoá body thô từ client về LivestreamV2Input — thiếu field nào thì lấy mặc định. */
function normalize(body: Partial<LivestreamV2Input>): LivestreamV2Input {
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
  // dialoguesPerScene ảnh hưởng trực tiếp độ dài lời thoại/đoạn: kẹp 1..5 để 1 số vô lý (0 hay 99)
  // không đẻ ra script không đọc kịp trong 8s rồi bị Veo cắt cụt.
  const perScene = Number(body.dialoguesPerScene);
  return {
    advantages: Array.isArray(body.advantages)
      ? body.advantages.map((a) => String(a).trim()).filter(Boolean)
      : [],
    platform: str(body.platform, DEFAULT_V2_INPUT.platform) || DEFAULT_V2_INPUT.platform,
    channelName: str(body.channelName),
    followerCount: str(body.followerCount),
    viewerCount: str(body.viewerCount),
    promotion: str(body.promotion),
    cta: str(body.cta),
    dialoguesPerScene: Number.isFinite(perScene) ? Math.min(5, Math.max(1, Math.round(perScene))) : 3,
  };
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await jobExists(params.id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Partial<LivestreamV2Input>;
  const input = normalize(body);
  await writeV2Input(params.id, input);
  return NextResponse.json({ input });
}
