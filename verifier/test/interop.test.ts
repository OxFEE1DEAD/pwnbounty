import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonical, commitment } from '../../protocol/index.ts';
import { open, rawKey } from '../src/crypto.ts';
import { openDisclosure, sealReport } from '../../web/src/crypto.ts';

const seed = createHash('sha256')
  .update('sealed-bounty interop fixture only, never use as a real key')
  .digest();
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const recipient = rawKey(createPublicKey(privateKey));

test('browser WebCrypto opens the TypeScript envelope', async () => {
  const vector = JSON.parse(await readFile('fixtures/interop-report.json', 'utf8')) as {
    context: string;
    plaintext: string;
    ciphertext: string;
  };
  const context = JSON.parse(vector.context);
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  assert.equal(
    await openDisclosure(Buffer.from(vector.ciphertext, 'base64'), der, context),
    vector.plaintext,
  );
  await assert.rejects(
    openDisclosure(Buffer.from(vector.ciphertext, 'base64'), der, { ...context, bounty: '8' }),
  );
});

test('browser sealed report opens in the Node verifier with the same commitment', async () => {
  Object.defineProperty(globalThis, 'isSecureContext', { value: true, configurable: true });
  const context = {
    network: 'testnet',
    contract: 'bounty.testnet',
    bounty: '7',
    hunter: 'hunter.testnet',
    submission: 'a'.repeat(64),
  };
  const attack = 'Invoice 450 → vendor.near';
  const report = await sealReport(context, attack, recipient.toString('base64'));
  const plain = JSON.parse(
    open(Buffer.from(report.ciphertext, 'base64'), privateKey, canonical(context)).toString('utf8'),
  ) as { nonce: string; attack: string };
  assert.equal(plain.attack, attack);
  assert.equal(report.report_hash, commitment(context, plain.nonce, attack));
});
