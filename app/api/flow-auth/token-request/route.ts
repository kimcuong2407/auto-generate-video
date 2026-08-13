import { NextRequest, NextResponse } from 'next/server';
import { getActiveAccount } from '@/lib/googleFlow/authStore';
import {
  listPendingRequests,
  markPolled,
  storeRecaptchaToken,
} from '@/lib/googleFlow/recaptcha';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CORS: content script gọi cross-origin từ labs.google tới endpoint này (local dev).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET (content script short-poll ~1.5s): trả danh sách pending token request để
 * extension mint token tương ứng. Cập nhật lastPollAt để server biết poller còn sống.
 */
export async function GET(req: NextRequest) {
  markPolled();
  const accountId =
    req.nextUrl.searchParams.get('accountId')?.trim() || getActiveAccount()?.id || undefined;
  const requests = listPendingRequests(accountId);
  return json({ requests });
}

/**
 * POST (content script trả token đã mint): resolve pending request đang chờ.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    accountId?: string;
    requestId?: string;
    action?: string;
    token?: string;
    error?: string;
  };

  const { accountId, requestId, action, token } = body;
  if (!requestId || !token) {
    return json({ error: 'Thiếu requestId hoặc token' }, 400);
  }

  const matched = storeRecaptchaToken(accountId || '', action || '', token, requestId);
  return json({ ok: true, matched });
}
