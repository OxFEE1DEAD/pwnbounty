import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
export const rawKey = (key: KeyObject): Buffer => Buffer.from(key.export({format:'der',type:'spki'})).subarray(-32);
export const ed25519Key = (raw: Uint8Array): KeyObject => {
  if (raw.length !== 32) throw new Error('Invalid Ed25519 key');
  return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});
};
const publicKey = (raw: Uint8Array): KeyObject => {
  if (raw.length !== 32) throw new Error('Invalid X25519 key');
  return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'),raw]),format:'der',type:'spki'});
};
const derive = (secret: Buffer, salt: Buffer) => Buffer.from(hkdfSync('sha256',secret,salt,'sealed-bounty/envelope/1',32));
export function seal(plain: Uint8Array, recipient: Uint8Array, context: string): Buffer {
  const pair=generateKeyPairSync('x25519'), salt=randomBytes(32), iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',derive(diffieHellman({privateKey:pair.privateKey,publicKey:publicKey(recipient)}),salt),iv);
  cipher.setAAD(Buffer.from(context));
  const body=Buffer.concat([cipher.update(plain),cipher.final()]);
  return Buffer.concat([Buffer.from([1]),rawKey(pair.publicKey),salt,iv,cipher.getAuthTag(),body]);
}
export function open(envelope: Uint8Array, key: KeyObject, context: string): Buffer {
  const b=Buffer.from(envelope);
  if(b.length<93 || b.length>1_048_576 || b[0]!==1) throw new Error('Invalid envelope');
  const decipher=createDecipheriv('aes-256-gcm',derive(diffieHellman({privateKey:key,publicKey:publicKey(b.subarray(1,33))}),b.subarray(33,65)),b.subarray(65,77));
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(b.subarray(77,93));
  return Buffer.concat([decipher.update(b.subarray(93)),decipher.final()]);
}
