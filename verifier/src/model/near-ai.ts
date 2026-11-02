import type { Message, Model, ToolCall } from '../target/agent.ts';
function payment(raw: string): { recipient: string; amount: string } {
  try {
    const args = JSON.parse(raw);
    if (
      args &&
      typeof args === 'object' &&
      !Array.isArray(args) &&
      Object.keys(args).sort().join() === 'amount,recipient' &&
      typeof args.recipient === 'string' &&
      typeof args.amount === 'string'
    )
      return { recipient: args.recipient, amount: args.amount };
  } catch {}
  return { recipient: '', amount: '' };
}
export class NearAiDevelopmentModel implements Model {
  constructor(private apiKey: string) {
    if (!apiKey) throw new Error('Missing NEAR_AI_APIKEY');
  }
  async complete(model: string, messages: readonly Message[], signal: AbortSignal) {
    const response = await fetch('https://cloud-api.near.ai/v1/chat/completions', {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          ...(m.calls?.length
            ? {
                tool_calls: m.calls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: {
                    name: 'transfer',
                    arguments: JSON.stringify({ recipient: c.recipient, amount: c.amount }),
                  },
                })),
              }
            : {}),
        })),
        tools: [
          {
            type: 'function',
            function: {
              name: 'transfer',
              description: 'Execute a payment in the isolated test ledger.',
              parameters: {
                type: 'object',
                properties: {
                  recipient: { type: 'string' },
                  amount: {
                    type: 'string',
                    description: 'Positive integer units as decimal string',
                  },
                },
                required: ['recipient', 'amount'],
                additionalProperties: false,
              },
            },
          },
        ],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`NEAR AI HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 262144) throw new Error('Model response too large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data?.choices?.[0]?.finish_reason === 'length') throw new Error('Model response truncated');
    const message = data?.choices?.[0]?.message;
    if (!message || (message.content !== null && typeof message.content !== 'string'))
      throw new Error('Invalid model response');
    const raw = message.tool_calls ?? [];
    if (!Array.isArray(raw) || raw.length > 8) throw new Error('Invalid tool calls');
    const ids = new Set<string>();
    const calls: ToolCall[] = raw.map((c: unknown) => {
      if (!c || typeof c !== 'object') throw new Error('Invalid tool call');
      const call = c as {
        id?: unknown;
        type?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      if (
        typeof call.id !== 'string' ||
        call.id.length > 128 ||
        ids.has(call.id) ||
        call.type !== 'function' ||
        call.function?.name !== 'transfer' ||
        typeof call.function.arguments !== 'string'
      )
        throw new Error('Invalid tool call');
      ids.add(call.id);
      return { id: call.id, ...payment(call.function.arguments) };
    });
    return { message: message.content ?? '', calls };
  }
}
