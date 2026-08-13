import { NextResponse } from 'next/server';
import { listAccountsPublic } from '@/lib/googleFlow/authStore';
import { pendingTokenCount, lastPollAt } from '@/lib/googleFlow/recaptcha';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Trạng thái tài khoản + poller reCAPTCHA (on-demand mint). */
export async function GET() {
  const accounts = listAccountsPublic();
  const last = lastPollAt();
  return NextResponse.json({
    accounts,
    recaptcha: {
      pendingCount: pendingTokenCount(),
      lastPollAt: last || null,
      pollerAliveMsAgo: last ? Date.now() - last : null,
    },
  });
}
