import type { Bounty, Entry, Network, Snapshot, Verifier } from './chain.js';
import type { SealedReport } from './crypto.js';
import type { Meta, Program } from './env.js';
import type { ChainCommitment } from './settlement.js';

export interface ContractConfig {
  network: Network;
  protocol_version: string;
  bounty_count: string;
  bounty_storage_deposit: string;
  claim_storage_deposit: string;
  storage_byte_cost: string;
  verifier_registration: string;
  runner: Runner;
  verifier: Verifier | null;
  claim_limits: Record<string, number>;
}

export interface Runner {
  outlayer: string;
  project: string;
  version: string;
  secrets_owner: string;
  secrets_profile: string;
}

export interface HunterClaim {
  bounty: string;
  submission: string;
  commitment: ChainCommitment;
}

export interface ChainReader {
  readonly network: Network;
  readonly contract: string;
  snapshot(): Promise<Snapshot>;
  config(): Promise<ContractConfig>;
  bounty(id: string, blockHash?: string): Promise<Bounty>;
  allBounties(): Promise<{ entries: Entry[]; height: bigint }>;
  commitment(
    bounty: string,
    hunter: string,
    submission: string,
  ): Promise<{ commitment: ChainCommitment | null; blockHash: string }>;
  hunterClaims(hunter: string, fromIndex: number, limit: number): Promise<HunterClaim[]>;
  accountUrl(account: string): string;
  txUrl(hash: string): string;
}

export interface ProgramSummary {
  id: string;
  kind: Program['kind'] | null;
}

export interface WorkerClaim {
  report_hash: string;
  settled: boolean;
}

export interface VerifierApi {
  readonly meta: Meta;
  programs(): Promise<ProgramSummary[]>;
  program(id: string): Promise<Program>;
  claim(bounty: string, hunter: string, submission: string): Promise<WorkerClaim | undefined>;
  fee(report: SealedReport): Promise<string>;
  disclosure(bounty: string, hunter: string, submission: string): Promise<Uint8Array>;
}

export interface CreateProgram {
  rules_hash: string;
  team_key: string;
  reward: string;
  expires: string;
  settle_until: string;
  program: string;
}

export interface Wallet {
  account(): Promise<string | undefined>;
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  submit(report: SealedReport, deposit: string, fee: string): Promise<string | undefined>;
  claim(report: SealedReport, fee: string): Promise<string | undefined>;
  retryPayment(bounty: string, hunter: string): Promise<void>;
  withdraw(bounty: string): Promise<void>;
  create(program: CreateProgram, deposit: string): Promise<string | undefined>;
}

export interface Ports {
  chain: ChainReader;
  worker: VerifierApi;
  wallet: Wallet;
}
