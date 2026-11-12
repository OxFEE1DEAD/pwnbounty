import type { Holding, Judgement, Role, RunEvidence, Snapshot } from '../../../protocol/program.ts';
import { holds, invariantWords, parse } from '../../../protocol/rule.ts';

const terminal = {
  limit: 'limit',
  invalid_attack: 'invalid_attack',
  pending: 'inconclusive',
  infra_error: 'infra_error',
} as const;

const NEAR = 'NEAR';

function complete(s: Snapshot, tokens: string[]): boolean {
  const native = Object.values(s.native).reduce(
    (sum, a) => sum + BigInt(a.amount) + BigInt(a.locked),
    0n,
  );
  if (native !== BigInt(s.totalSupply)) return false;
  return tokens.every(
    (token) =>
      s.holdings.filter((h) => h.token === token).reduce((sum, h) => sum + BigInt(h.amount), 0n) ===
      BigInt(s.supplies[token] ?? -1),
  );
}

function balances(s: Snapshot, account: string): Map<string, bigint> {
  const native = s.native[account];
  const result = new Map([[NEAR, native ? BigInt(native.amount) + BigInt(native.locked) : 0n]]);
  for (const h of s.holdings)
    if (h.account === account) result.set(h.token, (result.get(h.token) ?? 0n) + BigInt(h.amount));
  return result;
}

export function judge(e: RunEvidence): Judgement {
  if (e.status !== 'complete') return { outcome: terminal[e.status], deltas: [] };
  const inconclusive: Judgement = { outcome: 'inconclusive', deltas: [] };
  const rates = new Map(e.spec.tokens.map((t) => [t.contract, BigInt(t.rate)]));
  const tokens = [...rates.keys()];
  if (!complete(e.before, tokens) || !complete(e.after, tokens)) return inconclusive;

  const attackers = Object.keys(e.roles).filter((a) => e.roles[a] === 'attacker');
  const role = (account: string): Role => {
    const fixed = e.roles[account];
    if (fixed === 'protected' || fixed === 'system' || fixed === 'attacker') return fixed;
    if (attackers.some((a) => account.endsWith(`.${a}`))) return 'attacker';
    const keys = e.after.keys[account] ?? [];
    if (keys.some((k) => k.full && e.attackerKeys.includes(k.key))) return 'attacker';
    return 'neutral';
  };

  const value = (s: Snapshot, account: string) => {
    let v = 0n;
    for (const [token, n] of balances(s, account))
      v += token === NEAR ? n : n * (rates.get(token) ?? 0n);
    if (rates.has(account)) v -= BigInt(s.supplies[account] ?? 0) * rates.get(account)!;
    return v;
  };

  const accounts = new Set([
    ...Object.keys(e.before.native),
    ...Object.keys(e.after.native),
    ...e.before.holdings.map((h) => h.account),
    ...e.after.holdings.map((h) => h.account),
    ...tokens,
  ]);
  const delta: Record<Role, bigint> = { attacker: 0n, protected: 0n, neutral: 0n, system: 0n };
  const deltas: Holding[] = [];
  for (const account of accounts) {
    const r = role(account);
    const before = balances(e.before, account);
    const after = balances(e.after, account);
    delta[r] += value(e.after, account) - value(e.before, account);
    if (r === 'neutral' || r === 'system') continue;
    for (const token of new Set([...before.keys(), ...after.keys()])) {
      const d = (after.get(token) ?? 0n) - (before.get(token) ?? 0n);
      if (d !== 0n) deltas.push({ account, token, amount: d.toString() });
    }
  }

  const supply = BigInt(e.after.totalSupply) - BigInt(e.before.totalSupply);
  if (delta.attacker + delta.protected + delta.neutral + delta.system !== supply)
    return inconclusive;
  const attributable = delta.neutral + delta.system >= 0n && supply <= 0n;

  for (const rule of e.spec.rules) {
    if (rule.id === 'take') {
      const t = BigInt(rule.threshold);
      if (attributable && delta.attacker > t && -delta.protected > t)
        return { outcome: 'violation', rule: 'take', deltas };
    }
    if (rule.id === 'invariant') {
      const values = { attacker_gain: delta.attacker, protected_loss: -delta.protected };
      if (!holds(parse(rule.text, invariantWords), values))
        return { outcome: 'violation', rule: 'invariant', deltas };
    }
    if (rule.id === 'loss') {
      const t = BigInt(rule.threshold);
      if (-delta.protected > t) return { outcome: 'violation', rule: 'loss', deltas };
    }
    if (rule.id === 'block') {
      const { attacked, control } = e;
      if (!attacked || !control) return inconclusive;
      if (!control.ok || BigInt(control.received) !== BigInt(rule.expect.amount))
        return inconclusive;
      if (control.entitlement !== attacked.entitlement) continue;
      if (!attacked.ok || BigInt(attacked.received) < BigInt(rule.expect.amount))
        return { outcome: 'violation', rule: 'block', deltas };
    }
  }
  return { outcome: 'no_violation', deltas };
}
