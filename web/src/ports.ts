import type { Bounty, Entry, Network, Snapshot } from './chain.js';
import type { SealedReport } from './crypto.js';
import type { Meta, Program } from './env.js';
import type { ChainCommitment, SettlementVerdict } from './settlement.js';

export interface ContractConfig {
  network: Network;
  protocol_version: string;
  bounty_count: string;
  bounty_storage_deposit: string;
  claim_storage_deposit: string;
  verifier_registration: string;
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

export interface Job {
  id: string;
  state: string;
  transaction?: string;
  errorCode?: string;
  outlayerCallId?: string;
  verdict?: SettlementVerdict;
  signature?: string;
}

export interface WorkerClaim {
  report_hash: string;
  settled: boolean;
}

export interface VerifierApi {
  readonly meta: Meta;
  programs(): Promise<ProgramSummary[]>;
  program(id: string): Promise<Program>;
  claim(bounty: string, hunter: string, submission: string): Promise<WorkerClaim>;
  submit(report: SealedReport): Promise<{ id: string }>;
  job(id: string): Promise<Job>;
  disclosure(hash: string): Promise<Uint8Array>;
}

export interface Wallet {
  account(): Promise<string | undefined>;
  connect(): Promise<string | undefined>;
  disconnect(): Promise<void>;
  commit(report: SealedReport, deposit: string): Promise<void>;
  retryPayment(bounty: string, hunter: string): Promise<void>;
  withdraw(bounty: string): Promise<void>;
}

export interface Ports {
  chain: ChainReader;
  worker: VerifierApi;
  wallet: Wallet;
}
