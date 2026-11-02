import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verdictMessage, type Verdict } from '../../../protocol/index.ts';
import { rawKey, open } from '../crypto.ts';
import type { Enclave, Attestation } from '../interfaces.ts';
export class LocalEnclave implements Enclave {
  constructor(
    private box: KeyObject,
    private signer: KeyObject,
  ) {}
  static async load(encryptionPath: string, signingPath: string): Promise<LocalEnclave> {
    const [enc, sig] = await Promise.all([readFile(encryptionPath), readFile(signingPath)]);
    return new LocalEnclave(
      createPrivateKey({ key: enc, format: 'der', type: 'pkcs8' }),
      createPrivateKey({ key: sig, format: 'der', type: 'pkcs8' }),
    );
  }
  static generate(): { enclave: LocalEnclave; encryptionPrivate: Buffer; signingPrivate: Buffer } {
    const box = generateKeyPairSync('x25519'),
      signer = generateKeyPairSync('ed25519');
    const encryptionPrivate = Buffer.from(box.privateKey.export({ format: 'der', type: 'pkcs8' }));
    const signingPrivate = Buffer.from(signer.privateKey.export({ format: 'der', type: 'pkcs8' }));
    return {
      enclave: new LocalEnclave(box.privateKey, signer.privateKey),
      encryptionPrivate,
      signingPrivate,
    };
  }
  async attestation(): Promise<Attestation> {
    return {
      kind: 'local',
      publicKey: rawKey(createPublicKey(this.signer)),
      encryptionKey: rawKey(createPublicKey(this.box)),
      quote: new Uint8Array(),
    };
  }
  async open(ciphertext: Uint8Array, context: string) {
    return open(ciphertext, this.box, context);
  }
  async sign(verdict: Verdict) {
    return sign(null, verdictMessage(verdict), this.signer);
  }
}
