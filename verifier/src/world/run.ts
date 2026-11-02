import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Code,
  Judgement,
  ProgramSpec,
  Rule,
  RunEvidence,
  TxAttack,
  VictimResult,
} from '../../../protocol/program.ts';
import type { WorldFactory, WorldHandle } from '../interfaces.ts';
import { judge } from './judge.ts';

type Block = Extract<Rule, { id: 'block' }>;

export function codeLoader(dir: string) {
  const cache = new Map<string, Promise<Uint8Array>>();
  const fetchCode = async (code: Code): Promise<Uint8Array> => {
    if (code.source === 'wasm') return readFile(join(dir, `${code.sha256}.wasm`));
    const response = await fetch(`https://archival-rpc.${code.network}.fastnear.com`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'query',
        params: {
          request_type: 'view_code',
          block_id: Number(code.block),
          account_id: code.account,
        },
      }),
    });
    const body = (await response.json()) as { result?: { code_base64: string } };
    if (!body.result) throw new Error(`No code for ${code.account}`);
    return Buffer.from(body.result.code_base64, 'base64');
  };
  return (code: Code) => {
    if (!cache.has(code.sha256)) cache.set(code.sha256, fetchCode(code));
    return cache.get(code.sha256)!;
  };
}

async function victim(world: WorldHandle, rule: Block): Promise<VictimResult> {
  const { account, token } = rule.expect;
  const entitlement = await world.view(rule.claim);
  const balance = async () =>
    BigInt(
      JSON.parse(
        await world.view({
          contract: token,
          method: 'ft_balance_of',
          args: { account_id: account },
        }),
      ),
    );
  const before = token === 'NEAR' ? 0n : await balance();
  const receipts = await world.call(rule.victim);
  const received =
    token === 'NEAR'
      ? receipts
          .filter((r) => r.receiver === account && r.predecessor !== 'system' && r.ok)
          .reduce((sum, r) => sum + BigInt(r.deposit), 0n)
      : (await balance()) - before;
  return {
    ok: receipts.length > 0 && receipts.every((r) => r.ok),
    received: received.toString(),
    entitlement,
  };
}

export async function runProgram(
  worlds: WorldFactory,
  spec: ProgramSpec,
  attack: string,
): Promise<{ judgement: Judgement; evidence?: RunEvidence }> {
  if (Buffer.byteLength(attack, 'utf8') > spec.limits.bytes)
    return { judgement: { outcome: 'limit', deltas: [] } };
  let parsed: TxAttack;
  try {
    parsed = JSON.parse(attack);
  } catch {
    return { judgement: { outcome: 'invalid_attack', deltas: [] } };
  }
  const world = await worlds.create(spec);
  try {
    const before = await world.snapshot([]);
    const { receipts, status } = await world.send(parsed);
    const after = await world.snapshot(receipts.flatMap((r) => [...r.mentioned, ...r.created]));
    const evidence: RunEvidence = {
      spec,
      roles: world.roles,
      attackerKeys: world.attackerKeys,
      before,
      after,
      receipts,
      status,
    };
    const block = spec.rules.find((r): r is Block => r.id === 'block');
    if (block && status === 'complete') {
      const height = await world.height();
      evidence.attacked = await victim(world, block);
      const twin = await worlds.create(spec);
      try {
        await twin.forward(Math.max(0, height - (await twin.height())));
        evidence.control = await victim(twin, block);
      } finally {
        await twin.stop();
      }
    }
    return { judgement: judge(evidence), evidence };
  } finally {
    await world.stop();
  }
}
