/**
 * Client MCP tới app Orino Flow (HTTP streamable, chạy localhost).
 *
 * Vì sao tự viết thay vì dùng SDK @modelcontextprotocol/sdk: chỉ cần 1 method (tools/call)
 * trên 1 server cục bộ, không cần sampling/roots/notifications. Thêm dependency cho 60 dòng
 * là lỗ vốn.
 *
 * Giao thức: server trả SSE (`data: {...}`) kể cả cho request đơn, nên phải bóc tiền tố
 * `data:` trước khi JSON.parse — trả thẳng JSON.parse vào body là hỏng.
 */

import { FlowApiError } from './errors';
import { flowLog } from '../flowLog';

const DEFAULT_URL = 'http://127.0.0.1:51888/mcp';

export function mcpConfig(): { url: string; token: string } {
  return {
    url: process.env.ORINO_FLOW_MCP_URL || DEFAULT_URL,
    token: process.env.ORINO_FLOW_MCP_TOKEN || '',
  };
}

/** Bóc body SSE hoặc JSON thuần thành các object JSON-RPC. */
function parseRpcBody(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.startsWith('data:') ? rawLine.slice(5).trim() : rawLine.trim();
    if (!line.startsWith('{')) continue;
    try {
      out.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Dòng SSE chưa trọn vẹn — bỏ qua, dòng sau mới là JSON đủ.
    }
  }
  return out;
}

let nextId = 1;

/**
 * Gọi 1 tool MCP và trả về text kết quả (đã ghép nếu server trả nhiều content block).
 *
 * timeoutMs mặc định 15 phút: `flow_generate_image` chặn tới khi xong (tài liệu Orino ghi tối đa
 * 10 phút), nên timeout ngắn hơn là tự cắt giữa chừng một job đã tốn quota.
 */
export async function mcpCall(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 15 * 60_000
): Promise<string> {
  const { url, token } = mcpConfig();
  if (!token) {
    throw new FlowApiError(
      'Chưa cấu hình ORINO_FLOW_MCP_TOKEN trong .env.local — bật MCP Server trong app Orino Flow để lấy token.'
    );
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  });

  const startedAt = Date.now();
  flowLog('mcp', `→ gọi ${tool}`, {
    args: JSON.stringify(args).slice(0, 300),
    timeoutMs,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    // ECONNREFUSED = app Orino tắt hoặc chưa bật công tắc MCP Server. Nói thẳng cách sửa,
    // vì lỗi fetch gốc ("fetch failed") không gợi ý được gì cho người vận hành.
    const reason = (err as Error).name === 'AbortError' ? `quá ${timeoutMs}ms không phản hồi` : String(err);
    flowLog('mcp', `✗ ${tool} KHÔNG kết nối được`, { url, tookMs: Date.now() - startedAt, reason: reason.slice(0, 200) });
    throw new FlowApiError(
      `Không gọi được Orino MCP (${url}): ${reason}. Kiểm tra app Orino Flow đang chạy và đã bật công tắc "MCP Server".`
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new FlowApiError(`Orino MCP trả HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
  }

  const messages = parseRpcBody(text);
  const reply = messages.find((m) => 'result' in m || 'error' in m);
  if (!reply) {
    throw new FlowApiError(`Orino MCP trả về body không đọc được cho ${tool}: ${text.slice(0, 300)}`);
  }

  const rpcError = reply.error as { message?: string } | undefined;
  if (rpcError) {
    throw new FlowApiError(`Orino MCP lỗi khi gọi ${tool}: ${rpcError.message || JSON.stringify(rpcError)}`);
  }

  const result = reply.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const out = (result.content || [])
    .map((c) => c.text || '')
    .join('')
    .trim();

  // isError=true là lỗi NGHIỆP VỤ (tool chạy nhưng thất bại), khác rpcError ở trên là lỗi giao
  // thức. Nội dung lỗi nằm trong content nên phải ném kèm, đừng trả về như kết quả hợp lệ.
  if (result.isError) {
    flowLog('mcp', `✗ ${tool} lỗi nghiệp vụ`, { tookMs: Date.now() - startedAt, out: out.slice(0, 300) });
    throw new FlowApiError(`Orino MCP: ${tool} thất bại: ${out.slice(0, 400)}`);
  }
  flowLog('mcp', `✓ ${tool} OK`, { tookMs: Date.now() - startedAt, out: out.slice(0, 300) });
  return out;
}

/**
 * Gọi tool và parse JSON. Orino trả JSON dưới dạng text trong content block.
 *
 * Khi text KHÔNG phải JSON thì đó là thông báo lỗi dạng chữ (VD "unknown job_id: ..." hoặc
 * "Lỗi tạo project Google Flow: ..."), nên ném nguyên văn — chính là câu người vận hành cần đọc.
 */
export async function mcpCallJson<T>(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<T> {
  const text = await mcpCall(tool, args, timeoutMs);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new FlowApiError(`Orino MCP: ${tool} trả về lỗi: ${text.slice(0, 400)}`);
  }
}
