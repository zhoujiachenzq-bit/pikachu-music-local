import { ApiError } from './api';
import type { AgentClientContext, AgentStreamEvent } from '../shared/types';

export interface AgentMessageRequest {
  conversationId: string;
  message: string;
  generation: number;
  webSearch: boolean;
  context: AgentClientContext;
}

export async function streamAgentMessage(input: AgentMessageRequest, onEvent: (event: AgentStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/agent/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(input), signal
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError('SERVICE_UNAVAILABLE', '珍奇暂时无法连接，音乐播放不受影响。', undefined, 503);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(payload?.error?.code || 'AGENT_REQUEST_FAILED', payload?.error?.message || '珍奇暂时无法连接。', payload?.error?.details, response.status);
  }
  if (!response.body) throw new ApiError('AGENT_STREAM_EMPTY', '珍奇没有返回内容。');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    try { onEvent(JSON.parse(data) as AgentStreamEvent); } catch { /* Ignore malformed isolated events; the next event can still complete the run. */ }
  };
  while (true) {
    const { done, value } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop() || ''; blocks.forEach(consume);
    if (done) { if (buffer.trim()) consume(buffer); break; }
  }
}
