import { NextRequest, NextResponse } from 'next/server';
import { readAppSettings, writeAppSettings } from '@/lib/data/appSettingsStore';
import { VEO_MODELS, type VeoModel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const s = readAppSettings();
  return NextResponse.json({ veoModel: s.veoModel, useMcp: s.useMcp, options: VEO_MODELS });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { veoModel?: string | null; useMcp?: boolean };
  if (body.veoModel !== undefined && body.veoModel !== null && !(VEO_MODELS as readonly string[]).includes(body.veoModel)) {
    return NextResponse.json({ error: `Model không hợp lệ: ${body.veoModel}` }, { status: 400 });
  }
  // Chỉ ghi field có trong body: trang gửi riêng lẻ từng cờ, gộp hết vào một patch sẽ xoá
  // veoModel về null mỗi lần bật/tắt MCP.
  const patch: Parameters<typeof writeAppSettings>[0] = {};
  if (body.veoModel !== undefined) patch.veoModel = (body.veoModel || null) as VeoModel | null;
  if (body.useMcp !== undefined) patch.useMcp = body.useMcp === true;
  const settings = writeAppSettings(patch);
  return NextResponse.json({ veoModel: settings.veoModel, useMcp: settings.useMcp, options: VEO_MODELS });
}
