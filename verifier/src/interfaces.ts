import type { Context, TargetConfig, Verdict } from '../../protocol/index.ts';
import type {
  Call,
  Outcome,
  ProgramSpec,
  ReceiptOutcome,
  Role,
  RunEvidence,
  Snapshot,
  TxAttack,
  View,
} from '../../protocol/program.ts';
export type { Verdict, TargetConfig };
export interface SealedReport extends Context {
  report_hash: string;
  ciphertext: Uint8Array;
}
export interface Attestation {
  kind: 'local' | 'tee';
  publicKey: Uint8Array;
  encryptionKey: Uint8Array;
  quote: Uint8Array;
}
export interface Enclave {
  attestation(): Promise<Attestation>;
  open(ciphertext: Uint8Array, context: string): Promise<Uint8Array>;
  sign(verdict: Verdict): Promise<Uint8Array>;
}
export interface Program {
  context: Omit<Context, 'hunter' | 'submission'>;
  config: TargetConfig;
  rules_hash: string;
  teamKey: Uint8Array;
  verdictExpires: string;
}
export interface ProgramSource {
  load(report: SealedReport): Promise<Program>;
}
export interface Disclosure {
  publish(ciphertext: Uint8Array): Promise<string>;
}
export interface Settler {
  settle(verdict: Verdict, signature: Uint8Array): Promise<string>;
}
export interface TrustPolicy {
  verify(attestation: Attestation, program: Program): Promise<void>;
}
export interface WorldHandle {
  roles: Record<string, Role>;
  attackerKeys: string[];
  send(attack: TxAttack): Promise<{ receipts: ReceiptOutcome[]; status: RunEvidence['status'] }>;
  call(call: Call): Promise<ReceiptOutcome[]>;
  view(view: View): Promise<string>;
  snapshot(mentioned: string[]): Promise<Snapshot>;
  forward(blocks: number): Promise<void>;
  height(): Promise<number>;
  stop(): Promise<void>;
}
export interface WorldFactory {
  create(spec: ProgramSpec): Promise<WorldHandle>;
}
export interface Target {
  run(
    program: Program,
    attack: string,
  ): Promise<{ valid: boolean; outcome: Outcome; trace: unknown }>;
}
