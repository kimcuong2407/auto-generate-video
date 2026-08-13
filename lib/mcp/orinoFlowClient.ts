/**
 * Client JSON-RPC thuần cho MCP server "Orino Flow" (local, port mặc định 51888).
 *
 * Đã xác minh thật bằng curl trước khi viết file này:
 * - Response là JSON thuần (Content-Type: application/json), KHÔNG phải SSE.
 * - KHÔNG cần handshake `initialize` trước khi gọi `tools/list`/`tools/call`.
 * - Format `tools/call` response:
 *   { "id":.., "jsonrpc":"2.0", "result": { "content": [{ "type":"text", "text": "<JSON string>" }], "isError": false } }
 *   → cần JSON.parse(result.content[0].text) để lấy object thật.
 */

let requestIdCounter = 1;

export class McpToolError extends Error {
  code?: number;
  data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.data = data;
  }
}

interface JsonRpcResponse {
  id: number;
  jsonrpc: '2.0';
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    structuredContent?: unknown;
  };
  error?: { code: number; message: string; data?: unknown };
}

function getMcpConfig(): { url: string; token: string } {
  const url = process.env.ORINO_FLOW_MCP_URL || 'http://127.0.0.1:51888/mcp';
  const token = process.env.ORINO_FLOW_MCP_TOKEN || '';
  if (!token) {
    throw new McpToolError(
      'Thiếu ORINO_FLOW_MCP_TOKEN — cần lấy token trong app Orino Flow (mục Bật MCP Server) và đặt vào .env.local'
    );
  }
  return { url, token };
}

export async function callMcpTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  const { url, token } = getMcpConfig();
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestIdCounter++,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new McpToolError(`Gọi MCP tool "${name}" quá thời gian chờ (${timeoutMs}ms)`);
    }
    throw new McpToolError(
      `Không kết nối được tới MCP Orino Flow tại ${url}. Kiểm tra app Orino Flow đã bật MCP Server chưa. (${(err as Error).message})`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new McpToolError(`MCP HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = (await response.json()) as JsonRpcResponse;

  if (payload.error) {
    throw new McpToolError(payload.error.message, payload.error.code, payload.error.data);
  }

  const result = payload.result;
  if (!result) {
    throw new McpToolError(`MCP tool "${name}" không trả về "result"`);
  }

  if (result.isError) {
    const text = result.content?.[0]?.text ?? 'Lỗi không rõ từ MCP tool';
    throw new McpToolError(`MCP tool "${name}" báo lỗi: ${text}`);
  }

  const textBlock = result.content?.find((c) => c.type === 'text')?.text;
  if (textBlock === undefined) {
    throw new McpToolError(`MCP tool "${name}" không trả về nội dung text để parse`);
  }

  try {
    return JSON.parse(textBlock) as T;
  } catch {
    // Một số tool có thể trả text thuần (không phải JSON) — trả nguyên văn.
    return textBlock as unknown as T;
  }
}
