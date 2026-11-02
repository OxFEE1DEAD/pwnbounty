import test from 'node:test';
import assert from 'node:assert/strict';
import { OutLayerClient } from '../src/outlayer/client.ts';
import { NonRetryablePrepareError } from '../src/jobs.ts';

const config = {
  model: 'test',
  prompt: 'test',
  policy: { allowedRecipients: ['vendor.near'], maxTransfer: '100' },
  initialBalance: '1000',
  enforcePolicy: true,
  maxSteps: 1,
  timeoutMs: 1000,
};
const report = {
  network: 'testnet',
  contract: 'bounty.testnet',
  bounty: '0',
  hunter: 'hunter.testnet',
  submission: '0'.repeat(64),
  report_hash: '1'.repeat(64),
  ciphertext: Buffer.alloc(93),
};

test('long OutLayer execution uses one async call and polls its identity', async () => {
  const original = globalThis.fetch;
  const callId = '550e8400-e29b-41d4-a716-446655440000';
  let accepted: string | undefined;
  const requests: { url: string; method: string; body?: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (requests.length === 1)
      return Response.json({
        call_id: callId,
        status: 'pending',
        poll_url: `/calls/${callId}`,
        attestation_url: `/attestations/by-call/${callId}`,
      });
    return Response.json({ call_id: callId, status: 'failed', error: 'worker failed' });
  };
  try {
    const client = new OutLayerClient({
      network: 'testnet',
      project: 'owner.testnet/runner',
      versionHash: '0'.repeat(64),
      paymentKey: 'owner.testnet:1:ABCDEFGHIJKLMNOPQRSTUVWX',
      sealedState: 'opaque',
    });
    await assert.rejects(
      client.executeSealed(report, config, {
        accepted: async (id) => {
          accepted = id;
        },
      }),
      NonRetryablePrepareError,
    );
    assert.equal(requests.length, 2);
    assert.equal(accepted, callId);
    assert.equal(requests[0]?.method, 'POST');
    assert.equal((requests[0]?.body as { async: boolean }).async, true);
    assert.equal(requests[1]?.url, `https://testnet-api.outlayer.ai/calls/${callId}`);
  } finally {
    globalThis.fetch = original;
  }
});

test('recorded OutLayer call is polled without submitting a new paid call', async () => {
  const original = globalThis.fetch;
  const callId = '550e8400-e29b-41d4-a716-446655440000';
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ call_id: callId, status: 'failed', error: 'worker failed' });
  };
  try {
    const client = new OutLayerClient({
      network: 'testnet',
      project: 'owner.testnet/runner',
      versionHash: '0'.repeat(64),
      paymentKey: 'owner.testnet:1:ABCDEFGHIJKLMNOPQRSTUVWX',
      sealedState: 'opaque',
    });
    await assert.rejects(
      client.executeSealed(report, config, {
        callId,
        accepted: async () => {
          throw new Error('unexpected POST');
        },
      }),
      NonRetryablePrepareError,
    );
    assert.deepEqual(urls, [`https://testnet-api.outlayer.ai/calls/${callId}`]);
  } finally {
    globalThis.fetch = original;
  }
});
