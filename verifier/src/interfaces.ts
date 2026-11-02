export type BountyId = number;

export interface Verdict {
  bounty: BountyId;
  report_hash: string;
  hunter: string;
  valid: boolean;
  disclosure_hash: string;
}

export interface SealedReport {
  bounty: BountyId;
  hunter: string;
  ciphertext: Uint8Array;
}

export interface Attestation {
  publicKey: Uint8Array;
  quote: Uint8Array;
}

export interface Enclave {
  attestation(): Promise<Attestation>;
  open(report: SealedReport): Promise<Uint8Array>;
  seal(plaintext: Uint8Array, teamKey: string): Promise<Uint8Array>;
  sign(verdict: Verdict): Promise<Uint8Array>;
}

export interface Judge {
  judge(bounty: BountyId, report: Uint8Array): Promise<boolean>;
}

export interface Disclosure {
  publish(bounty: BountyId, sealed: Uint8Array): Promise<string>;
}

export interface Settler {
  settle(verdict: Verdict, signature: Uint8Array): Promise<string>;
}

export interface Verifier {
  process(report: SealedReport): Promise<Verdict>;
}
