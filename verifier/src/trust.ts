import type { Attestation, Program, TrustPolicy } from './interfaces.ts';
export class RejectUnverifiedTrust implements TrustPolicy {
  async verify(_attestation: Attestation, _program: Program): Promise<void> {
    throw new Error('Verified TEE adapter is not configured; execution refused');
  }
}
export class LocalDevelopmentTrust implements TrustPolicy {
  async verify(attestation: Attestation): Promise<void> {
    if(attestation.kind!=='local'||attestation.quote.length!==0) throw new Error('Expected explicitly local development enclave');
  }
}
