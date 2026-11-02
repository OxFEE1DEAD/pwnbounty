import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutLayerClient } from '../src/outlayer/client.ts';

test('OutLayer proof verifier uses the current API endpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sealed-bounty-verify-api-'));
  const script = join(directory, 'fake-verify.cjs'),
    capture = join(directory, 'api.txt');
  const callId = '550e8400-e29b-41d4-a716-446655440000',
    hash = '0'.repeat(64);
  const source = `#!/usr/bin/env node
const fs=require('node:fs');
const args=process.argv.slice(2), value=name=>args[args.indexOf(name)+1];
fs.writeFileSync(${JSON.stringify(capture)},value('--api'));
const input=JSON.parse(fs.readFileSync(value('--input'),'utf8'));
const output=JSON.parse(fs.readFileSync(value('--output'),'utf8'));
fs.writeFileSync(value('--bundle'),JSON.stringify({bundle_format:1,network:'testnet',input,output,attestation:{wasm_hash:${JSON.stringify(hash)},project_id:'owner.testnet/runner',call_id:${JSON.stringify(callId)}}}));
console.log(JSON.stringify({format:'V1',uncovered_fields:[],authenticity:{verdict:'pass'},identity:{verdict:'pass'},binding:{verdict:'pass'},input:{verdict:'pass'},output:{verdict:'pass'}}));
`;
  await writeFile(script, source, { mode: 0o700 });
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      status: 'completed',
      call_id: callId,
      attestation_url: `/attestations/by-call/${callId}`,
      output: { signing_public_key: 'example' },
    });
  try {
    const client = new OutLayerClient({
      network: 'testnet',
      project: 'owner.testnet/runner',
      versionHash: hash,
      paymentKey: 'owner.testnet:1:ABCDEFGHIJKLMNOPQRSTUVWX',
      verifyBin: script,
      evidenceDirectory: join(directory, 'evidence'),
    });
    const result = await client.provision();
    assert.equal(result.callId, callId);
    assert.equal(await readFile(capture, 'utf8'), 'https://testnet-api.outlayer.ai');
  } finally {
    globalThis.fetch = original;
    await rm(directory, { recursive: true, force: true });
  }
});
