const encoder = new TextEncoder();
export interface Context {
  network: string;
  contract: string;
  bounty: string;
  hunter: string;
  submission: string;
}
export interface SealedReport extends Context {
  report_hash: string;
  ciphertext: string;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const item = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(item)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(item[key]))
        .join(',') +
      '}'
    );
  }
  throw new Error('Unsupported protocol value');
}
export const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export function base64(bytes: Uint8Array): string {
  let value = '';
  for (let start = 0; start < bytes.length; start += 8192)
    value += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(value);
}
export function unbase64(value: string): Uint8Array {
  if (value.length > 1_400_000) throw new Error('Ciphertext too large');
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (base64(bytes) !== value) throw new Error('Non-canonical base64');
  return bytes;
}
export async function digest(bytes: Uint8Array | string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        typeof bytes === 'string' ? encoder.encode(bytes) : bytes,
      ),
    ),
  );
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
async function key(privateKey: CryptoKey, peer: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  if (peer.length !== 32) throw new Error('Invalid X25519 public key length');
  const publicKey = await crypto.subtle.importKey('raw', peer, { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256,
  );
  const source = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('sealed-bounty/envelope/1') },
    source,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function sealReport(
  context: Context,
  attack: string,
  recipient: string,
): Promise<SealedReport> {
  if (!isSecureContext || !crypto.subtle)
    throw new Error('HTTPS or localhost is required for encryption');
  if (encoder.encode(attack).length > 65536) throw new Error('Invoice larger than 64 KiB');
  const nonce = randomHex(),
    report_hash = await digest(canonical(['sealed-bounty/report/1', context, nonce, attack]));
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const salt = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await key(pair.privateKey, unbase64(recipient), salt);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(canonical(context)), tagLength: 128 },
      aes,
      encoder.encode(canonical({ nonce, attack })),
    ),
  );
  const ephemeral = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const tag = encrypted.subarray(encrypted.length - 16),
    body = encrypted.subarray(0, encrypted.length - 16);
  return {
    ...context,
    report_hash,
    ciphertext: base64(concat(new Uint8Array([1]), ephemeral, salt, iv, tag, body)),
  };
}
export async function openDisclosure(
  envelope: Uint8Array,
  privateDer: ArrayBuffer,
  context: Context,
): Promise<string> {
  if (envelope.length < 93 || envelope.length > 1_048_576 || envelope[0] !== 1)
    throw new Error('Invalid envelope');
  const privateKey = await crypto.subtle.importKey('pkcs8', privateDer, { name: 'X25519' }, false, [
    'deriveBits',
  ]);
  const aes = await key(privateKey, envelope.subarray(1, 33), envelope.subarray(33, 65));
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: envelope.subarray(65, 77),
      additionalData: encoder.encode(canonical(context)),
      tagLength: 128,
    },
    aes,
    concat(envelope.subarray(93), envelope.subarray(77, 93)),
  );
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}
export async function verifyVerdict(
  value: unknown,
  signature: string,
  signingKey: string,
): Promise<boolean> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.version !== '1' || typeof v.valid !== 'boolean') return false;
  for (const field of [
    'network',
    'contract',
    'bounty',
    'hunter',
    'submission',
    'rules_hash',
    'report_hash',
    'disclosure_hash',
    'expires',
  ])
    if (typeof v[field] !== 'string') return false;
  for (const field of ['submission', 'rules_hash', 'report_hash', 'disclosure_hash'])
    if (!/^[a-f0-9]{64}$/.test(v[field] as string)) return false;
  const sig = unbase64(signature),
    pub = unbase64(signingKey);
  if (sig.length !== 64 || pub.length !== 32) return false;
  const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
  const message = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(
      JSON.stringify([
        'sealed-bounty/verdict/1',
        v.network,
        v.contract,
        v.bounty,
        v.hunter,
        v.submission,
        v.rules_hash,
        v.report_hash,
        v.valid,
        v.disclosure_hash,
        v.expires,
      ]),
    ),
  );
  return crypto.subtle.verify({ name: 'Ed25519' }, key, sig, message);
}
