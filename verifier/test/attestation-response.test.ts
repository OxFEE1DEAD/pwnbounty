import test from 'node:test';
import assert from 'node:assert/strict';
import { readAttestationJson } from '../src/model/attestation.ts';

test('attestation JSON retains the exact bytes used for its report hash', async () => {
  const body = '{"ok":true}';
  const result = await readAttestationJson(new Response(body));
  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.bytes.toString('utf8'), body);
});

test('attestation response rejects an oversized stream before reading the remainder', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(16));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readAttestationJson(new Response(body), 8), /too large/);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
});

test('attestation response rejects a declared oversized body without reading it', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull() { pulls++; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readAttestationJson(new Response(body, { headers: { 'content-length': '100' } }), 8), /too large/);
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
});
