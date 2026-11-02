import { amount, type TargetConfig, type Verdict } from '../../../protocol/index.ts';

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  return value;
}
export function hex(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
export function accountId(value: unknown): string {
  const result = text(value, 'account ID');
  if (result.length < 2 || result.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(result))
    throw new Error('Invalid account ID');
  return result;
}
export function u64(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^(0|[1-9][0-9]{0,19})$/.test(result) || BigInt(result) > (1n << 64n) - 1n)
    throw new Error(`Invalid ${label}`);
  return result;
}
export function bytes32(value: unknown, label: string): Buffer {
  const result = text(value, label),
    bytes = Buffer.from(result, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== result)
    throw new Error(`Invalid ${label}`);
  return bytes;
}
export function targetConfig(value: unknown): TargetConfig {
  const c = object(value, 'target config'),
    p = object(c.policy, 'policy');
  const model = text(c.model, 'model'),
    prompt = text(c.prompt, 'prompt');
  if (!model || model.length > 256 || Buffer.byteLength(prompt) > 65536)
    throw new Error('Invalid model or prompt');
  if (
    !Array.isArray(p.allowedRecipients) ||
    p.allowedRecipients.length < 1 ||
    p.allowedRecipients.length > 256
  )
    throw new Error('Invalid recipients');
  const allowedRecipients = p.allowedRecipients.map(accountId);
  if (new Set(allowedRecipients).size !== allowedRecipients.length)
    throw new Error('Duplicate recipients');
  const maxTransfer = text(p.maxTransfer, 'max transfer'),
    initialBalance = text(c.initialBalance, 'balance');
  amount(maxTransfer);
  amount(initialBalance);
  if (typeof c.enforcePolicy !== 'boolean') throw new Error('Invalid enforcement flag');
  if (
    typeof c.maxSteps !== 'number' ||
    !Number.isInteger(c.maxSteps) ||
    c.maxSteps < 1 ||
    c.maxSteps > 20
  )
    throw new Error('Invalid step limit');
  if (
    typeof c.timeoutMs !== 'number' ||
    !Number.isInteger(c.timeoutMs) ||
    c.timeoutMs < 1 ||
    c.timeoutMs > 120000
  )
    throw new Error('Invalid timeout');
  const modelPolicyHash =
    c.modelPolicyHash === undefined ? undefined : hex(c.modelPolicyHash, 'model policy hash');
  const result: TargetConfig = {
    model,
    prompt,
    policy: { allowedRecipients, maxTransfer },
    initialBalance,
    enforcePolicy: c.enforcePolicy,
    maxSteps: c.maxSteps,
    timeoutMs: c.timeoutMs,
    ...(modelPolicyHash ? { modelPolicyHash } : {}),
  };
  if (
    Object.keys(c).sort().join(',') !== Object.keys(result).sort().join(',') ||
    Object.keys(p).sort().join(',') !== 'allowedRecipients,maxTransfer'
  )
    throw new Error('Unknown config fields');
  return result;
}

export function verdict(value: unknown): Verdict {
  const v = object(value, 'verdict');
  if (
    v.version !== '1' ||
    typeof v.valid !== 'boolean' ||
    !['testnet', 'mainnet'].includes(text(v.network, 'network'))
  )
    throw new Error('Invalid verdict version/network/result');
  return {
    version: '1',
    network: text(v.network, 'network'),
    contract: accountId(v.contract),
    bounty: u64(v.bounty, 'bounty'),
    hunter: accountId(v.hunter),
    submission: hex(v.submission, 'submission'),
    rules_hash: hex(v.rules_hash, 'rules hash'),
    report_hash: hex(v.report_hash, 'report hash'),
    valid: v.valid,
    disclosure_hash: hex(v.disclosure_hash, 'disclosure hash'),
    expires: u64(v.expires, 'verdict expiry'),
  };
}
