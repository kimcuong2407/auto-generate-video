import { NextRequest, NextResponse } from 'next/server';
import { readAppSettings, writeAppSettings } from '@/lib/data/appSettingsStore';
import { VEO_MODELS, type VeoModel } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ veoModel: readAppSettings().veoModel, options: VEO_MODELS });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { veoModel?: string | null };
  if (body.veoModel !== undefined && body.veoModel !== null && !(VEO_MODELS as readonly string[]).includes(body.veoModel)) {
    return NextResponse.json({ error: `Model không hợp lệ: ${body.veoModel}` }, { status: 400 });
  }
  const settings = writeAppSettings({ veoModel: (body.veoModel || null) as VeoModel | null });
  return NextResponse.json({ veoModel: settings.veoModel, options: VEO_MODELS });
}
