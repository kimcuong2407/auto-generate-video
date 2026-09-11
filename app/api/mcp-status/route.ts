import { NextResponse } from 'next/server';
import { getFlowStatusMcp } from '@/lib/googleFlow/mcpJobs';
import { mcpConfig } from '@/lib/googleFlow/mcpClient';
import { readAppSettings } from '@/lib/data/appSettingsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Kiểm tra gọi được app Orino Flow (MCP) hay không — để người dùng biết TRƯỚC khi bấm gen,
 * thay vì phát hiện qua một cảnh failed.
 *
 * Trả cả `flow_connected` của Orino: MCP sống nhưng Orino chưa đăng nhập Google thì vẫn
 * không gen được, và hai nguyên nhân này cần phân biệt rõ.
 */
export async function GET() {
  const { url, token } = mcpConfig();
  if (!token) {
    return NextResponse.json({
      reachable: false,
      error: 'Chưa cấu hình ORINO_FLOW_MCP_TOKEN trong .env.local',
      url,
    });
  }

  const startedAt = Date.now();
  const status = await getFlowStatusMcp();
  const tookMs = Date.now() - startedAt;

  // getFlowStatusMcp nuốt lỗi kết nối thành projects_error — phân biệt "không gọi được MCP"
  // với "gọi được nhưng Orino chưa đăng nhập Google" bằng chính flow_connected.
  const unreachable = /Không gọi được Orino MCP|Chưa cấu hình/i.test(status.projects_error || '');
  return NextResponse.json({
    reachable: !unreachable,
    flowConnected: status.flow_connected,
    useMcp: readAppSettings().useMcp,
    tookMs,
    url,
    error: unreachable ? status.projects_error : undefined,
    warning: !unreachable && !status.flow_connected
      ? 'Gọi được MCP nhưng app Orino chưa đăng nhập Google Flow — vào Cài đặt của Orino để đăng nhập.'
      : undefined,
  });
}
