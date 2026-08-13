/** Đọc SSE stream của POST /api/projects/[id]/script/generate, trả về khi gặp event 'result' hoặc 'error'. */
export async function runScriptGenerateSSE(projectId: string, scriptAngleId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/script/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptAngleId }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let errorMessage: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = rawEvent.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let event: { type?: string; message?: string };
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (event.type === 'result') finished = true;
      else if (event.type === 'error') errorMessage = event.message || 'Sinh nháp AI thất bại';
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  if (!finished) throw new Error('Kết nối tới AI bị ngắt trước khi hoàn tất, vui lòng thử lại');
}
