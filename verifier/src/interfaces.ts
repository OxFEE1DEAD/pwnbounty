import type { Context, TargetConfig, Verdict } from '../../protocol/index.ts';
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
