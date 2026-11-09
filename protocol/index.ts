import { createHash } from 'node:crypto';
export const digest = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const o = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(o[k]))
        .join(',') +
      '}'
    );
  }
  throw new Error('Unsupported canonical value');
}
export interface Context {
  network: string;
  contract: string;
  bounty: string;
  hunter: string;
  submission: string;
}
export interface Verdict extends Context {
  version: '1';
  rules_hash: string;
  report_hash: string;
  valid: boolean;
  disclosure_hash: string;
  expires: string;
}
export function verdictMessage(v: Verdict): Buffer {
  return Buffer.from(
    digest(
      JSON.stringify([
        'sealed-bounty/verdict/1',
        v.network,
        v.contract,
        v.bounty,
        v.hunter,
        v.submission,
        v.rules_hash,
        v.report_hash,
        v.valid,
        v.disclosure_hash,
        v.expires,
      ]),
    ),
    'hex',
  );
}
export function commitment(c: Context, nonce: string, attack: string): string {
  if (!/^[0-9a-f]{64}$/.test(nonce)) throw new Error('Expected 32-byte random nonce');
  return digest(canonical(['sealed-bounty/report/1', c, nonce, attack]));
}
export interface LimitPolicy {
  allowedRecipients: string[];
  maxTransfer: string;
}
export type Policy = LimitPolicy | { rule: string };
export function limits(policy: Policy): LimitPolicy {
  if ('rule' in policy) throw new Error('Payment rules are checked in the TEE only');
  return policy;
}
export interface TargetConfig {
  model: string;
  prompt: string;
  policy: Policy;
  initialBalance: string;
  enforcePolicy: boolean;
  maxSteps: number;
  timeoutMs: number;
  modelPolicyHash?: string;
}
export const rulesHash = (config: TargetConfig) => digest(canonical(config));
export function amount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,38})$/.test(value)) throw new Error('Invalid amount');
  const n = BigInt(value);
  if (n > (1n << 128n) - 1n) throw new Error('Amount exceeds u128');
  return n;
}
