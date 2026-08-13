/**
 * Client gọi API sinh text dạng OpenAI-compatible (chat completions), dùng thay thế
 * cho gemini_generate của MCP Orino Flow khi phiên đăng nhập Gemini chưa sẵn sàng.
 *
 * Hỗ trợ streaming (SSE) để tránh Cloudflare cắt kết nối ở ~100s (lỗi HTTP 524):
 * khi stream, byte đầu tiên trả về sớm nên proxy không timeout dù model xử lý lâu.
 * Kèm retry tự động cho các lỗi tạm thời (524/5xx / mạng) và thông báo lỗi gọn
 * thay vì đổ nguyên khối HTML của trang lỗi Cloudflare cho người dùng.
 */

import { readAppSettings } from '../data/appSettingsStore';

export class ChatApiError extends Error {}

/** Sự kiện tiến trình phát ra trong lúc gọi AI, dùng để log/forward cho client (SSE). */
export interface ChatStreamEvent {
  type: 'start' | 'delta' | 'retry' | 'error';
  attempt?: number;
  maxAttempts?: number;
  delta?: string;
  message?: string;
}

export type ChatEventHandler = (event: ChatStreamEvent) => void;

/** Ảnh đính kèm cho 1 lượt gọi vision (đọc ảnh chụp màn hình sản phẩm...). */
export interface ChatImageInput {
  mimeType: string;
  base64: string;
}

function getChatApiConfig(modelOverride?: string): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = process.env.AI_CHAT_API_URL || '';
  const apiKey = process.env.AI_CHAT_API_KEY || '';
  // Model có thể được người dùng chọn ở màn hình Cài đặt AI (lưu vào data/app-settings.json),
  // ghi đè lên AI_CHAT_API_MODEL mặc định trong .env.local. modelOverride (VD gọi vision với
  // AI_VISION_MODEL riêng) có độ ưu tiên cao nhất — không phụ thuộc lựa chọn model chat của user.
  const model = modelOverride || readAppSettings().chatModel || process.env.AI_CHAT_API_MODEL || '';
  if (!baseUrl || !apiKey || !model) {
    throw new ChatApiError(
      'Thiếu cấu hình AI_CHAT_API_URL / AI_CHAT_API_KEY / AI_CHAT_API_MODEL trong .env.local'
    );
  }
  return { baseUrl, apiKey, model };
}

const DEFAULT_TIMEOUT_MS = Number(process.env.AI_CHAT_API_TIMEOUT_MS || 180_000);
const MAX_RETRIES = Math.max(0, Number(process.env.AI_CHAT_API_MAX_RETRIES ?? 2));
const USE_STREAM = (process.env.AI_CHAT_API_STREAM ?? 'true').toLowerCase() !== 'false';

/** Trả về true nếu chuỗi trông giống một trang HTML (VD trang lỗi 524 của Cloudflare). */
function looksLikeHtml(text: string): boolean {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<html');
}

/** Dựng thông điệp lỗi gọn cho người dùng từ status + body, ẩn HTML trang lỗi Cloudflare. */
function buildHttpErrorMessage(status: number, body: string): string {
  if (status === 524 || looksLikeHtml(body)) {
    return `AI server phản hồi quá lâu (HTTP ${status} – proxy timeout). Vui lòng bấm sinh lại sau giây lát.`;
  }
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 300);
  return `AI API HTTP ${status}${snippet ? `: ${snippet}` : ''}`;
}

/** Lỗi HTTP tạm thời (nên retry): 524 hoặc 5xx. 4xx là lỗi cấu hình/nội dung, không retry. */
function isRetriableStatus(status: number): boolean {
  return status === 524 || (status >= 500 && status <= 599);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Đọc thân response SSE và nối các mảnh choices[].delta.content thành chuỗi hoàn chỉnh. */
async function readSseContent(
  response: Response,
  onEvent?: ChatEventHandler,
  onFirstByte?: () => void
): Promise<string> {
  if (!response.body) {
    throw new ChatApiError('AI API không trả về body để đọc stream');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let firstByteSeen = false;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return; // dòng rỗng / comment SSE
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
      };
      const piece =
        chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content ?? '';
      if (piece) {
        content += piece;
        onEvent?.({ type: 'delta', delta: piece });
      }
    } catch {
      // Bỏ qua mảnh JSON chưa hoàn chỉnh / không parse được
    }
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstByteSeen) {
      firstByteSeen = true;
      onFirstByte?.();
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      consumeLine(line);
    }
  }
  // Xử lý phần còn lại trong buffer (nếu server không kết thúc bằng newline)
  if (buffer.trim()) consumeLine(buffer);

  return content;
}

/** Thực hiện 1 lần gọi (không retry). Ném ChatApiError khi lỗi. */
/** Nội dung message user: string thường, hoặc mảng multimodal (text + image_url) khi có ảnh đính kèm. */
function buildUserContent(user: string, images?: ChatImageInput[]): unknown {
  if (!images || images.length === 0) return user;
  return [
    { type: 'text', text: user },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
    })),
  ];
}

async function callOnce(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
  onEvent?: ChatEventHandler,
  images?: ChatImageInput[]
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestStartedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: USE_STREAM ? 'text/event-stream' : 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: USE_STREAM,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: buildUserContent(user, images) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ChatApiError(`Gọi AI API quá thời gian chờ (${timeoutMs}ms)`);
    }
    throw new ChatApiError(`Không kết nối được tới AI API tại ${url}: ${(err as Error).message}`);
  }

  try {
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const message = buildHttpErrorMessage(response.status, text);
      const error = new ChatApiError(message) as ChatApiError & { status?: number };
      error.status = response.status;
      throw error;
    }

    if (USE_STREAM) {
      const content = await readSseContent(response, onEvent, () => {
        console.log(`[chatClient] TTFB sau ${Date.now() - requestStartedAt}ms`);
      });
      if (!content) {
        throw new ChatApiError('AI API không trả về nội dung hợp lệ (stream rỗng)');
      }
      console.log(`[chatClient] attempt hoàn tất sau ${Date.now() - requestStartedAt}ms (${content.length} ký tự)`);
      return content;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (content === undefined) {
      throw new ChatApiError('AI API không trả về nội dung hợp lệ');
    }
    console.log(`[chatClient] attempt hoàn tất sau ${Date.now() - requestStartedAt}ms (${content.length} ký tự)`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function chatCompletion(
  system: string,
  user: string,
  opts: { timeoutMs?: number; onEvent?: ChatEventHandler; model?: string; images?: ChatImageInput[] } = {}
): Promise<string> {
  const { baseUrl, apiKey, model } = getChatApiConfig(opts.model);
  const url = new URL('/v1/chat/completions', baseUrl).toString();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = MAX_RETRIES + 1;
  const totalStartedAt = Date.now();

  let lastError: ChatApiError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    opts.onEvent?.({ type: 'start', attempt: attempt + 1, maxAttempts });
    console.log(`[chatClient] bắt đầu lần thử ${attempt + 1}/${maxAttempts}`);
    try {
      const content = await callOnce(url, apiKey, model, system, user, timeoutMs, opts.onEvent, opts.images);
      console.log(`[chatClient] tổng thời gian ${Date.now() - totalStartedAt}ms (${attempt + 1} lần thử)`);
      return content;
    } catch (err) {
      const e = err as ChatApiError & { status?: number };
      lastError = e;
      // Chỉ retry với lỗi HTTP tạm thời (524/5xx). Lỗi khác (4xx, parse...) ném ngay.
      const retriable = typeof e.status === 'number' && isRetriableStatus(e.status);
      console.error(`[chatClient] lần thử ${attempt + 1}/${maxAttempts} lỗi: ${e.message}`);
      if (!retriable || attempt === MAX_RETRIES) break;
      opts.onEvent?.({ type: 'retry', attempt: attempt + 2, maxAttempts, message: e.message });
      await sleep(1000 * (attempt + 1)); // backoff tăng dần: 1s, 2s, ...
    }
  }

  console.error(`[chatClient] thất bại sau ${Date.now() - totalStartedAt}ms (${maxAttempts} lần thử)`);
  // Bổ sung số lần đã thử vào thông điệp cuối để người dùng biết đã tự retry.
  const suffix = MAX_RETRIES > 0 ? ` (đã thử ${maxAttempts} lần)` : '';
  const finalMessage = `${lastError?.message ?? 'Gọi AI API thất bại'}${suffix}`;
  opts.onEvent?.({ type: 'error', message: finalMessage });
  throw new ChatApiError(finalMessage);
}
