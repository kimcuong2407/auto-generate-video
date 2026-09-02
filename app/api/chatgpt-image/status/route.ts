import { NextResponse } from 'next/server';
import { isExtensionOnline, lastExtensionPollAt } from '@/lib/chatgptImage/extensionPresence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trạng thái extension gen ảnh cho UI Cài đặt — same-origin, không cần CORS (khác route
 * /worker vốn extension gọi cross-origin).
 */
export async function GET() {
  const at = lastExtensionPollAt();
  return NextResponse.json({
    online: isExtensionOnline(),
    lastPollAt: at === 0 ? null : new Date(at).toISOString(),
  });
}
