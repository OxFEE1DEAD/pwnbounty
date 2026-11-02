import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { canonical } from '../../protocol/index.ts';
import { rawKey, seal } from '../src/crypto.ts';

const seed = createHash('sha256')
  .update('sealed-bounty interop fixture only, never use as a real key')
  .digest();
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const recipient = rawKey(createPublicKey(privateKey));
const context = canonical({
  network: 'testnet',
  contract: 'bounty.testnet',
  bounty: '7',
  hunter: 'hunter.testnet',
  submission: 'a'.repeat(64),
});
const plaintext = canonical({ nonce: 'b'.repeat(64), attack: 'Invoice 450 → vendor.near' });
const ciphertext = seal(Buffer.from(plaintext), recipient, context).toString('base64');
await writeFile(
  'fixtures/interop-report.json',
  JSON.stringify({ context, plaintext, ciphertext }, null, 2) + '\n',
);
