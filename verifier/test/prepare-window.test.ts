import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, rulesHash, type TargetConfig } from '../../protocol/index.ts';
import { parseModelPolicy } from '../src/model/attestation.ts';
import { NearProgramSource } from '../src/near/programs.ts';
import type { NearRpc } from '../src/near/rpc.ts';

test('program source rejects a paid preparation when the settlement window is too short', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sealed-bounty-prepare-window-'));
  const config: TargetConfig = {
    model: 'test',
    prompt: 'pay',
    policy: { allowedRecipients: ['vendor.near'], maxTransfer: '100' },
    initialBalance: '1000',
    enforcePolicy: true,
    maxSteps: 1,
    timeoutMs: 1000,
  };
  let hash = rulesHash(config);
  const signingKey = Buffer.alloc(32, 1),
    encryptionKey = Buffer.alloc(32, 2);
  let settleUntil = '399';
  const rpc = {
    network: 'testnet',
    snapshot: async () => ({ hash: 'final-block', height: 100n }),
    view: async (_contract: string, method: string) => {
      if (method === 'get_config') return { network: 'testnet', protocol_version: '1' };
      if (method === 'get_bounty')
        return {
          owner: 'owner.testnet',
          rules_hash: hash,
          team_key: Buffer.alloc(32, 3).toString('base64'),
          reward: '100',
          expires: '120',
          settle_until: settleUntil,
          state: 'Available',
          winner: null,
          verifier: {
            public_key: signingKey.toString('base64'),
            encryption_key: encryptionKey.toString('base64'),
            attestation_hash: '0'.repeat(64),
          },
        };
      if (method === 'get_commitment')
        return { report_hash: '1'.repeat(64), settled: false, verdict: null };
      throw new Error('Unexpected view');
    },
  } as unknown as NearRpc;
  const source = new NearProgramSource(rpc, {
    contract: 'bounty.testnet',
    configDirectory: directory,
    signingKey,
    encryptionKey,
    attestationHash: '0'.repeat(64),
    minPrepareWindowBlocks: 300n,
  });
  const report = {
    network: 'testnet',
    contract: 'bounty.testnet',
    bounty: '0',
    hunter: 'hunter.testnet',
    submission: '0'.repeat(64),
    report_hash: '1'.repeat(64),
    ciphertext: Buffer.alloc(93),
  };
  try {
    await assert.rejects(source.load(report), /Not enough time/);
    settleUntil = '400';
    await writeFile(join(directory, hash + '.json'), JSON.stringify(config));
    const program = await source.load(report);
    assert.equal(program.verdictExpires, '400');
    const strict = new NearProgramSource(rpc, {
      contract: 'bounty.testnet',
      configDirectory: directory,
      signingKey,
      encryptionKey,
      attestationHash: '0'.repeat(64),
      minPrepareWindowBlocks: 300n,
      requireModelPolicyHash: true,
    });
    await assert.rejects(strict.load(report), /does not pin model policy/);
    const policy = parseModelPolicy(
      JSON.parse(
        await readFile(join(process.cwd(), 'fixtures/model-policy/qwen3.8-27b.json'), 'utf8'),
      ),
    );
    config.modelPolicyHash = digest(canonical(policy));
    assert.equal(
      config.modelPolicyHash,
      '4903e892169b6638b8c9c2f1fffc0fb3da6b6a486ac744cdef113f2f5ec8c94c',
    );
    hash = rulesHash(config);
    await writeFile(join(directory, hash + '.json'), JSON.stringify(config));
    assert.equal((await strict.load(report)).rules_hash, hash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
