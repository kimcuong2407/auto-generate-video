import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouterModel {
  id: string;
  owned_by?: string;
}

export async function GET() {
  const baseUrl = process.env.AI_CHAT_API_URL || '';
  const apiKey = process.env.AI_CHAT_API_KEY || '';
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: 'Thiếu cấu hình AI_CHAT_API_URL / AI_CHAT_API_KEY trong .env.local' },
      { status: 400 }
    );
  }

  const url = new URL('/v1/models', baseUrl).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `9router trả về lỗi HTTP ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { data?: RouterModel[] };
    const models = (data.data || [])
      .map((m) => ({ id: m.id, ownedBy: m.owned_by || null }))
      .filter((m) => !!m.id);
    return NextResponse.json({ models });
  } catch (err) {
    const message = controller.signal.aborted
      ? 'Gọi 9router quá thời gian chờ'
      : `Không kết nối được tới 9router: ${(err as Error).message}`;
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
