import { NextRequest, NextResponse } from 'next/server';
import { readAppSettings, writeAppSettings } from '@/lib/data/appSettingsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const settings = readAppSettings();
  return NextResponse.json({
    chatModel: settings.chatModel,
    defaultModel: process.env.AI_CHAT_API_MODEL || null,
  });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { chatModel?: string | null };
  if (body.chatModel !== undefined && body.chatModel !== null && typeof body.chatModel !== 'string') {
    return NextResponse.json({ error: 'chatModel không hợp lệ' }, { status: 400 });
  }
  const chatModel = body.chatModel === undefined ? undefined : body.chatModel?.trim() || null;
  const settings = writeAppSettings({ chatModel });
  return NextResponse.json({
    chatModel: settings.chatModel,
    defaultModel: process.env.AI_CHAT_API_MODEL || null,
  });
}
