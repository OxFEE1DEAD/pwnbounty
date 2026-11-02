import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { amount, type Verdict } from '../../../protocol/index.ts';
import type { Program, ProgramSource, Rules, SealedReport } from '../interfaces.ts';
import { NearRpc, type Snapshot } from './rpc.ts';
import { accountId, bytes32, hex, object, rules, text, u64, verdict } from './validation.ts';

export const PREPARE_WINDOW_BLOCKS = { 'local-development': 160n, outlayer: 300n } as const;

export interface ChainProgram {
  owner: string;
  rules_hash: string;
  team_key: string;
  reward: string;
  expires: string;
  settle_until: string;
  verifier: { public_key: string; encryption_key: string; attestation_hash: string };
  state: string;
  winner: string | null;
}
export interface ChainCommitment {
  report_hash: string;
  settled: boolean;
  verdict?: Verdict | null;
  settled_at?: string | null;
}
export async function getProgram(
  rpc: NearRpc,
  contract: string,
  bounty: string,
  snapshot?: Snapshot,
): Promise<ChainProgram> {
  u64(bounty, 'bounty');
  const raw = object(await rpc.view(contract, 'get_bounty', { bounty }, snapshot), 'bounty');
  const verifier = object(raw.verifier, 'verifier');
  bytes32(raw.team_key, 'team key');
  bytes32(verifier.public_key, 'verifier key');
  bytes32(verifier.encryption_key, 'verifier encryption key');
  amount(text(raw.reward, 'reward'));
  const state = text(raw.state, 'payment state');
  if (!['Available', 'Pending', 'Retryable', 'Paid', 'Refunding', 'Closed'].includes(state))
    throw new Error('Unknown payment state');
  return {
    owner: accountId(raw.owner),
    rules_hash: hex(raw.rules_hash, 'rules hash'),
    team_key: text(raw.team_key, 'team key'),
    reward: text(raw.reward, 'reward'),
    expires: u64(raw.expires, 'expiry'),
    settle_until: u64(raw.settle_until, 'settlement deadline'),
    verifier: {
      public_key: text(verifier.public_key, 'verifier key'),
      encryption_key: text(verifier.encryption_key, 'verifier encryption key'),
      attestation_hash: hex(verifier.attestation_hash, 'attestation hash'),
    },
    state,
    winner: raw.winner === null ? null : accountId(raw.winner),
  };
}
export async function storedRules(directory: string, hash: string): Promise<Rules> {
  const bytes = await readFile(join(resolve(directory), hash + '.json'));
  if (bytes.length > 131072) throw new Error('Configuration too large');
  const { hash: actual, ...stored } = rules(JSON.parse(bytes.toString('utf8')));
  if (actual !== hash) throw new Error('Configuration hash mismatch');
  return stored;
}
export async function getCommitment(
  rpc: NearRpc,
  contract: string,
  report: Pick<SealedReport, 'bounty' | 'hunter' | 'submission'>,
  snapshot?: Snapshot,
): Promise<ChainCommitment> {
  u64(report.bounty, 'bounty');
  accountId(report.hunter);
  hex(report.submission, 'submission');
  const raw = object(
    await rpc.view(
      contract,
      'get_commitment',
      { bounty: report.bounty, hunter: report.hunter, submission: report.submission },
      snapshot,
    ),
    'commitment',
  );
  if (typeof raw.settled !== 'boolean') throw new Error('Invalid commitment state');
  return {
    report_hash: hex(raw.report_hash, 'report hash'),
    settled: raw.settled,
    ...(raw.verdict === undefined
      ? {}
      : { verdict: raw.verdict === null ? null : verdict(raw.verdict) }),
    ...(raw.settled_at === undefined
      ? {}
      : { settled_at: raw.settled_at === null ? null : u64(raw.settled_at, 'settlement height') }),
  };
}
export interface NearProgramOptions {
  contract: string;
  configDirectory: string;
  signingKey: Uint8Array;
  encryptionKey: Uint8Array;
  attestationHash: string;
  verdictLifetimeBlocks?: bigint;
  minPrepareWindowBlocks?: bigint;
  requireModelPolicyHash?: boolean;
}
export class NearProgramSource implements ProgramSource {
  private configDirectory: string;
  constructor(
    private rpc: NearRpc,
    private options: NearProgramOptions,
  ) {
    accountId(options.contract);
    hex(options.attestationHash, 'attestation hash');
    if (options.signingKey.length !== 32 || options.encryptionKey.length !== 32)
      throw new Error('Invalid runner signing key');
    if (options.verdictLifetimeBlocks !== undefined && options.verdictLifetimeBlocks < 1n)
      throw new Error('Invalid verdict lifetime');
    if (options.minPrepareWindowBlocks !== undefined && options.minPrepareWindowBlocks < 20n)
      throw new Error('Invalid prepare window');
    this.configDirectory = resolve(options.configDirectory);
  }
  async load(report: SealedReport): Promise<Program> {
    if (report.network !== this.rpc.network || report.contract !== this.options.contract)
      throw new Error('Report network/contract mismatch');
    hex(report.report_hash, 'report hash');
    const snapshot = await this.rpc.snapshot();
    const configuration = object(
      await this.rpc.view(report.contract, 'get_config', {}, snapshot),
      'contract config',
    );
    if (configuration.network !== report.network || configuration.protocol_version !== '1')
      throw new Error('Contract protocol/network mismatch');
    const [bounty, claim] = await Promise.all([
      getProgram(this.rpc, report.contract, report.bounty, snapshot),
      getCommitment(this.rpc, report.contract, report, snapshot),
    ]);
    if (
      bounty.state !== 'Available' ||
      snapshot.height + (this.options.minPrepareWindowBlocks ?? 20n) > BigInt(bounty.settle_until)
    )
      throw new Error('Not enough time to prepare and settle a verdict');
    if (claim.settled || claim.report_hash !== report.report_hash)
      throw new Error('Commitment unavailable or mismatched');
    if (
      bounty.verifier.public_key !== Buffer.from(this.options.signingKey).toString('base64') ||
      bounty.verifier.encryption_key !==
        Buffer.from(this.options.encryptionKey).toString('base64') ||
      bounty.verifier.attestation_hash !== this.options.attestationHash
    )
      throw new Error('Program verifier policy mismatch');
    const stored = await storedRules(this.configDirectory, bounty.rules_hash);
    if (
      this.options.requireModelPolicyHash &&
      (stored.kind !== 'agent' || !stored.config.modelPolicyHash)
    )
      throw new Error('OutLayer program does not pin model policy');
    const deadline = BigInt(bounty.settle_until),
      requested = snapshot.height + (this.options.verdictLifetimeBlocks ?? 1000n);
    return {
      ...stored,
      context: { network: report.network, contract: report.contract, bounty: report.bounty },
      rules_hash: bounty.rules_hash,
      teamKey: bytes32(bounty.team_key, 'team key'),
      verdictExpires: (requested < deadline ? requested : deadline).toString(),
    };
  }
}
