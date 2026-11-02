import { accountId, object, text } from './validation.ts';

export interface Snapshot {
  hash: string;
  height: bigint;
}
export class RpcError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
  ) {
    super(`NEAR RPC ${method} failed (${code})`);
  }
}
export class NearRpc {
  readonly url: string;
  constructor(
    url: string,
    readonly network: 'testnet' | 'mainnet',
    private timeoutMs = 20000,
  ) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' &&
      !(
        parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      )
    )
      throw new Error('RPC requires HTTPS or localhost');
    if (parsed.username || parsed.password)
      throw new Error('Credentials in RPC URL are not supported');
    this.url = parsed.toString();
  }
  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'sealed-bounty', method, params }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new RpcError(method, `HTTP_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new RpcError(method, 'EMPTY_RESPONSE');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8 * 1024 * 1024) throw new RpcError(method, 'RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')), 'RPC response');
    if (data.error) {
      const error = object(data.error, 'RPC error');
      throw new RpcError(
        method,
        typeof error.code === 'number' ? String(error.code) : 'REMOTE_ERROR',
      );
    }
    if (!('result' in data)) throw new RpcError(method, 'MISSING_RESULT');
    return data.result;
  }
  async assertNetwork(): Promise<void> {
    const status = object(await this.call('status', {}), 'node status');
    if (status.chain_id !== this.network) throw new Error('RPC network mismatch');
  }
  async snapshot(): Promise<Snapshot> {
    await this.assertNetwork();
    const block = object(await this.call('block', { finality: 'final' }), 'block');
    const header = object(block.header, 'block header');
    if (
      typeof header.height !== 'number' ||
      !Number.isSafeInteger(header.height) ||
      header.height < 0
    )
      throw new Error('Unsafe block height');
    return { hash: text(header.hash, 'block hash'), height: BigInt(header.height) };
  }
  async view(
    contract: string,
    method: string,
    args: Record<string, unknown>,
    snapshot?: Snapshot,
  ): Promise<unknown> {
    accountId(contract);
    const response = object(
      await this.call('query', {
        request_type: 'call_function',
        account_id: contract,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        ...(snapshot ? { block_id: snapshot.hash } : { finality: 'final' }),
      }),
      'view result',
    );
    if (
      !Array.isArray(response.result) ||
      response.result.length > 1048576 ||
      !response.result.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    )
      throw new Error('Invalid view bytes');
    return JSON.parse(Buffer.from(response.result).toString('utf8'));
  }
}
