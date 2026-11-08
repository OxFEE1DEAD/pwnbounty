import type { ChainReader, ContractConfig, HunterClaim } from './ports.js';
import type { ChainCommitment } from './settlement.js';

export type Network = 'mainnet' | 'testnet';
export interface Verifier {
  public_key: string;
  encryption_key: string;
  attestation_hash: string;
}
export interface Bounty {
  owner: string;
  reward: string;
  state: string;
  winner: string | null;
  rules_hash: string;
  expires: string;
  settle_until: string;
  verifier: Verifier;
  about?: string | null;
}
export function aboutOf(bounty: Bounty): { name?: string; link?: string } {
  try {
    const value = JSON.parse(bounty.about ?? '') as { name?: unknown; link?: unknown };
    return {
      name: typeof value.name === 'string' ? value.name.slice(0, 80) : undefined,
      link:
        typeof value.link === 'string' && /^https:\/\/\S+$/.test(value.link)
          ? value.link
          : undefined,
    };
  } catch {
    return {};
  }
}
export interface Entry {
  id: string;
  bounty: Bounty;
}
export interface Snapshot {
  hash: string;
  height: bigint;
}
export interface Overview {
  total: number;
  open: number;
  escrowed: bigint;
  paid: bigint;
  breaks: number;
}
const pageSize = 50n;
const inconsistent = 'NEAR RPC returned an inconsistent contract state';

export async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty ciphertext');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error('Ciphertext exceeds the limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function near(value: string | bigint): string {
  try {
    const n = BigInt(value),
      unit = 10n ** 24n;
    const fraction = (n % unit).toString().padStart(24, '0').replace(/0+$/, '').slice(0, 5);
    return (n / unit).toString() + (fraction ? '.' + fraction : '') + ' NEAR';
  } catch {
    return String(value) + ' yoctoNEAR';
  }
}

export class Chain implements ChainReader {
  constructor(
    readonly network: Network,
    readonly contract: string,
  ) {}

  private async rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://rpc.${this.network}.fastnear.com`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'sealed-bounty', method, params }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 1_048_576)));
    if (!response.ok || !body?.result) throw new Error(inconsistent);
    return body.result as T;
  }

  async snapshot(): Promise<Snapshot> {
    type Block = { header?: { hash?: string; height?: number } };
    const block = await this.rpc<Block>('block', { finality: 'final' });
    const { hash, height } = block.header ?? {};
    if (typeof hash !== 'string' || typeof height !== 'number') throw new Error(inconsistent);
    return { hash, height: BigInt(height) };
  }

  async view<T>(
    method: string,
    args: Record<string, unknown>,
    blockHash?: string,
    account = this.contract,
  ): Promise<{ value: T | null; blockHash: string }> {
    const result = await this.rpc<{ result?: number[]; block_hash?: string }>('query', {
      request_type: 'call_function',
      account_id: account,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
      ...(blockHash ? { block_id: blockHash } : { finality: 'final' }),
    });
    if (
      !Array.isArray(result.result) ||
      typeof result.block_hash !== 'string' ||
      (blockHash && result.block_hash !== blockHash)
    ) {
      throw new Error(inconsistent);
    }
    const value = JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T | null;
    return { value, blockHash: result.block_hash };
  }

  async bounty(id: string, blockHash?: string): Promise<Bounty> {
    const { value } = await this.view<Bounty>('get_bounty', { bounty: id }, blockHash);
    if (!value) throw new Error('Program not found in the contract');
    return value;
  }

  async config(): Promise<ContractConfig> {
    const { value } = await this.view<ContractConfig>('get_config', {});
    if (!value) throw new Error(inconsistent);
    return value;
  }

  async commitment(bounty: string, hunter: string, submission: string) {
    const args = { bounty, hunter, submission };
    const { value, blockHash } = await this.view<ChainCommitment>('get_commitment', args);
    return { commitment: value, blockHash };
  }

  async hunterClaims(hunter: string, fromIndex: number, limit: number): Promise<HunterClaim[]> {
    const args = { hunter, from_index: String(fromIndex), limit };
    const { value } = await this.view<HunterClaim[]>('get_hunter_commitments', args);
    return (value ?? []).map((claim) => ({ ...claim, bounty: String(claim.bounty) }));
  }

  async allBounties(): Promise<{ entries: Entry[]; height: bigint }> {
    const at = await this.snapshot();
    const { value: config } = await this.view<{ bounty_count: string }>('get_config', {}, at.hash);
    const count = BigInt(config?.bounty_count ?? '0');
    const pages: Promise<{ value: Entry[] | null }>[] = [];
    for (let from = 0n; from < count; from += pageSize) {
      const args = { from_index: from.toString(), limit: Number(pageSize) };
      pages.push(this.view<Entry[]>('get_bounties', args, at.hash));
    }
    const entries = (await Promise.all(pages)).flatMap((page) => page.value ?? []);
    return {
      entries: entries.map((entry) => ({ ...entry, id: String(entry.id) })),
      height: at.height,
    };
  }

  accountUrl(account: string): string {
    return `${this.explorer()}/address/${encodeURIComponent(account)}`;
  }

  txUrl(hash: string): string {
    return `${this.explorer()}/txns/${encodeURIComponent(hash)}`;
  }

  private explorer(): string {
    return this.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  }
}

export function isOpen(
  entry: Entry,
  finalizedHeight: bigint,
  minPrepareWindowBlocks: bigint,
): boolean {
  const { state, expires, settle_until } = entry.bounty;
  return (
    state === 'Available' &&
    finalizedHeight < BigInt(expires) &&
    finalizedHeight + minPrepareWindowBlocks <= BigInt(settle_until)
  );
}

export function overview(
  entries: Entry[],
  height: bigint,
  minPrepareWindowBlocks: bigint,
): Overview {
  const open = entries.filter((entry) => isOpen(entry, height, minPrepareWindowBlocks));
  const paid = entries.filter((entry) => entry.bounty.state === 'Paid');
  const sum = (list: Entry[]) => list.reduce((n, entry) => n + BigInt(entry.bounty.reward), 0n);
  return {
    total: entries.length,
    open: open.length,
    escrowed: sum(open),
    paid: sum(paid),
    breaks: paid.length,
  };
}
