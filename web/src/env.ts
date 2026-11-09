import { createContext, useContext, useEffect, useState } from 'react';
import { unbase64, type Context, type SealedReport } from './crypto.js';
import { Chain, type Bounty, type Network } from './chain.js';
import type { Ports, ProgramSummary, Runner, VerifierApi } from './ports.js';
import type { Spec } from './checks.js';

export interface Meta {
  network: Network;
  contract: string;
  signing_public_key: string;
  trust_mode: string;
  confidential_inference_verified: boolean;
  claim_storage_deposit: string;
  min_prepare_window_blocks: string;
  allow_mainnet_writes: boolean;
  runner: Runner;
  claim_limits: Record<string, number>;
  bounty_storage_deposit: string;
  storage_byte_cost: string;
  models: Record<string, string>;
}
export interface TargetConfig {
  model: string;
  prompt: string;
  policy: { rule: string } | { allowedRecipients: string[]; maxTransfer: string };
  initialBalance: string;
  enforcePolicy: boolean;
  maxSteps: number;
  timeoutMs: number;
  modelPolicyHash?: string;
}
export type Program = {
  id: string;
  bounty: Bounty;
  finalized_height?: string;
} & ({ kind: 'agent'; config: TargetConfig } | { kind: 'world'; spec: Spec });
export interface TeamDraft {
  hash: string;
  context: string;
}
export interface Note {
  text: string;
  error: boolean;
}
export interface Env extends Ports {
  meta: Meta;
  account?: string;
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  notify(text: string, error?: boolean): void;
  team: TeamDraft;
  setTeam(draft: TeamDraft): void;
}

const deployments: Record<Network, { contract: string; models: Record<string, string> }> = {
  testnet: {
    contract: 'pwnbounty-d1c276.testnet',
    models: {
      'Qwen/Qwen3.8-27B': '4903e892169b6638b8c9c2f1fffc0fb3da6b6a486ac744cdef113f2f5ec8c94c',
      'Qwen/Qwen3.6-35B-A3B-FP8':
        'e9a5614e8319001c7c5ee93f72ddf3c8125bb5873b08c7d0468e971f914db0c1',
      'deepseek-ai/DeepSeek-V4.1-Flash-1017':
        'f4cb3a86759dad7a84cffa2c9a1ce6bfec665a12e85c768aabc16c98f7ed93c6',
      'z-ai/glm-5.3-flash': 'e601ad158ba7f898f66f1ced184e55ed5a3b79840df0e9d8903b5cb2d4c456ce',
    },
  },
  mainnet: { contract: '', models: {} },
};

const kindOf = (raw: string): Program['kind'] =>
  'model' in (JSON.parse(raw) as object) ? 'agent' : 'world';

export class ChainVerifier implements VerifierApi {
  constructor(
    readonly meta: Meta,
    private chain: Chain,
  ) {}

  async programs(): Promise<ProgramSummary[]> {
    const { entries } = await this.chain.allBounties();
    return Promise.all(
      entries.map(async (entry) => ({ id: entry.id, kind: kindOf(await this.raw(entry.id)) })),
    );
  }

  async program(id: string): Promise<Program> {
    const at = await this.chain.snapshot();
    const [bounty, raw] = await Promise.all([
      this.chain.bounty(id, at.hash),
      this.raw(id, at.hash),
    ]);
    const base = { id, bounty, finalized_height: at.height.toString() };
    return kindOf(raw) === 'agent'
      ? { ...base, kind: 'agent', config: JSON.parse(raw) as TargetConfig }
      : { ...base, kind: 'world', spec: JSON.parse(raw) as Spec };
  }

  async claim(bounty: string, hunter: string, submission: string) {
    const { commitment } = await this.chain.commitment(bounty, hunter, submission);
    return commitment
      ? { report_hash: commitment.report_hash, settled: commitment.settled }
      : undefined;
  }

  async fee(report: SealedReport): Promise<string> {
    const args = {
      resource_limits: this.meta.claim_limits,
      input_len: report.ciphertext.length + 4096,
    };
    const { runner } = this.meta;
    const { value } = await this.chain.view<string>(
      'estimate_execution_cost',
      args,
      undefined,
      runner.outlayer,
    );
    if (!value || !/^[0-9]{1,39}$/.test(value)) throw new Error('OutLayer did not return a price');
    return ((BigInt(value) * 3n) / 2n).toString();
  }

  async disclosure(bounty: string, hunter: string, submission: string): Promise<Uint8Array> {
    const args = { bounty, hunter, submission };
    const { value } = await this.chain.view<string>('get_disclosure', args);
    if (!value) throw new Error('No report is stored for this claim');
    return unbase64(value);
  }

  private async raw(id: string, blockHash?: string): Promise<string> {
    const { value } = await this.chain.view<string>('get_program', { bounty: id }, blockHash);
    if (!value) throw new Error('Program not found in the contract');
    return value;
  }
}

export async function loadMeta(): Promise<Meta> {
  const network: Network =
    new URLSearchParams(location.search).get('network') === 'mainnet' ? 'mainnet' : 'testnet';
  const { contract, models } = deployments[network];
  if (!contract) throw new Error('No escrow is deployed on this network yet');
  const config = await new Chain(network, contract).config();
  if (config.network !== network || !config.verifier) {
    throw new Error('The escrow has no provisioned verifier');
  }
  return {
    network,
    contract,
    signing_public_key: config.verifier.public_key,
    trust_mode: 'outlayer',
    confidential_inference_verified: true,
    claim_storage_deposit: config.claim_storage_deposit,
    min_prepare_window_blocks: '300',
    allow_mainnet_writes: true,
    runner: config.runner,
    claim_limits: config.claim_limits,
    bounty_storage_deposit: config.bounty_storage_deposit,
    storage_byte_cost: config.storage_byte_cost,
    models,
  };
}

const accountPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export function context(value: unknown): Context {
  if (!value || typeof value !== 'object') throw new Error('Invalid context');
  const c = value as Record<string, unknown>;
  for (const field of ['network', 'contract', 'bounty', 'hunter', 'submission']) {
    if (typeof c[field] !== 'string') throw new Error('Invalid context field ' + field);
  }
  const { network, contract, bounty, hunter, submission } = c as unknown as Context;
  if (
    !['testnet', 'mainnet'].includes(network) ||
    !/^(0|[1-9][0-9]{0,19})$/.test(bounty) ||
    BigInt(bounty) > (1n << 64n) - 1n ||
    !/^[a-f0-9]{64}$/.test(submission)
  ) {
    throw new Error('Invalid network/bounty/submission');
  }
  for (const account of [contract, hunter]) {
    if (!accountPattern.test(account) || account.length < 2 || account.length > 64) {
      throw new Error('Invalid context account');
    }
  }
  return { network, contract, bounty, hunter, submission };
}

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Action failed';
export const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const EnvContext = createContext<Env | null>(null);

export function useEnv(): Env {
  const env = useContext(EnvContext);
  if (!env) throw new Error('Wait for the worker to load');
  return env;
}

interface Async<T> {
  value?: T;
  error?: string;
  loading: boolean;
  reload(): void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Omit<Async<T>, 'reload'>>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((previous) => ({ value: previous.value, loading: true }));
    load().then(
      (value) => live && setState({ value, loading: false }),
      (error) => live && setState({ error: errorText(error), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((n) => n + 1) };
}
