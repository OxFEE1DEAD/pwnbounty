import type { Bounty, Entry, Network, Snapshot, Verifier } from './chain.js';
import type { SealedReport } from './crypto.js';
import type { Meta, Program } from './env.js';
import type { ChainCommitment, SettlementVerdict } from './settlement.js';

export interface ContractConfig {
  network: Network;
  protocol_version: string;
  bounty_count: string;
  bounty_storage_deposit: string;
  claim_storage_deposit: string;
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
  commitment(bounty: string, hunter: string, submission: string): Promise<ChainCommitment | null>;
  hunterClaims(hunter: string, fromIndex: number, limit: number): Promise<HunterClaim[]>;
  accountUrl(account: string): string;
  txUrl(hash: string): string;
}

export interface ProgramSummary {
  id: string;
  kind: Program['kind'] | null;
}

export interface Job {
  id: string;
  state: string;
  transaction?: string;
  errorCode?: string;
  outlayerCallId?: string;
  verdict?: SettlementVerdict;
  signature?: string;
}

export interface VerifierApi {
  readonly meta: Meta;
  programs(): Promise<ProgramSummary[]>;
  program(id: string): Promise<Program>;
  submit(report: SealedReport): Promise<{ id: string }>;
  job(id: string): Promise<Job>;
  disclosure(hash: string): Promise<Uint8Array>;
}

export interface CreateArgs {
  rules_hash: string;
  team_key: string;
  reward: string;
  expires: string;
  settle_until: string;
  verifier: Verifier;
}

export interface Wallet {
  account(): Promise<string | undefined>;
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  commit(report: SealedReport, deposit: string): Promise<void>;
  retryPayment(bounty: string, hunter: string): Promise<void>;
  create(args: CreateArgs, deposit: string): Promise<string>;
  withdraw(bounty: string): Promise<void>;
}

export interface Ports {
  chain: ChainReader;
  verifier: VerifierApi;
  wallet: Wallet;
}
