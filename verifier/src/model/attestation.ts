import { X509Certificate, createHash, createPublicKey, randomBytes, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface ModelPolicy { model: string; mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; os_image_hash: string; compose_hash: string }
export interface ModelEvidence {
  model: string; signing_public_key: string; nonce: string; report_sha256: string; verified_at: string;
  intel: { pck_chain_root_sha256: string; qe_mrsigner: string; quote_signature: true; report_data_binding: true; measurements: true };
  nvidia: { overall: true; gpus: string[]; jwt_kid: string; expires: number };
  not_checked: string[];
}

const INTEL_ROOT_SHA256 = '44:A0:19:6B:2B:99:F8:89:B8:E1:49:E9:5B:80:7A:35:0E:74:24:96:43:99:E8:85:A7:CB:B8:CC:FA:B6:74:D3';
const INTEL_QE_MRSIGNER = 'dc9e2a7c6f948f17474e34a7fc43ed030f7c1563f1babddf6340c82e0e54a8c5';
const NRAS = 'https://nras.attestation.nvidia.com';

const u16 = (b: Buffer, o: number) => b.readUInt16LE(o), u32 = (b: Buffer, o: number) => b.readUInt32LE(o);
const sha = (algorithm: string, ...parts: Uint8Array[]) => { const h = createHash(algorithm); for (const p of parts) h.update(p); return h.digest(); };
const ecKey = (raw: Buffer, crv: 'P-256'): KeyObject => createPublicKey({ format: 'jwk', key: { kty: 'EC', crv, x: raw.subarray(0, 32).toString('base64url'), y: raw.subarray(32, 64).toString('base64url') } });
const ecdsa = (hash: string, data: Uint8Array, key: KeyObject, signature: Uint8Array) => verify(hash, data, { key, dsaEncoding: 'ieee-p1363' }, signature);
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function hexBytes(value: unknown, length?: number): Buffer {
  require(typeof value === 'string' && /^([0-9a-f]{2})*$/.test(value) && (length === undefined || value.length === length * 2), 'Invalid hex evidence');
  return Buffer.from(value, 'hex');
}

function verifyQuote(quote: Buffer, now: Date): string {
  require(quote.length >= 636 && u16(quote, 0) === 4 && u16(quote, 2) === 2 && u32(quote, 4) === 0x81, 'Unsupported TDX quote');
  const signed = quote.subarray(0, 632), data = quote.subarray(636, 636 + u32(quote, 632));
  require(data.length >= 134 && u16(data, 128) === 6, 'Unsupported quote certification data');
  const certification = data.subarray(134, 134 + u32(data, 130));
  const qeReport = certification.subarray(0, 384), qeSignature = certification.subarray(384, 448);
  const authEnd = 450 + u16(certification, 448), qeAuth = certification.subarray(450, authEnd);
  require(u16(certification, authEnd) === 5, 'Missing PCK certificate chain');
  const pem = certification.subarray(authEnd + 6, authEnd + 6 + u32(certification, authEnd + 2)).toString('utf8');
  const chain = (pem.match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g) ?? []).map(c => new X509Certificate(c));
  require(chain.length === 3 && chain[2]!.fingerprint256 === INTEL_ROOT_SHA256, 'PCK chain does not end at pinned Intel root');
  for (let i = 0; i < 3; i++) {
    const cert = chain[i]!, issuer = chain[Math.min(i + 1, 2)]!;
    require(cert.checkIssued(issuer) && cert.verify(issuer.publicKey) && new Date(cert.validFrom) <= now && now <= new Date(cert.validTo), 'Invalid PCK certificate chain');
  }
  require(ecdsa('sha256', qeReport, chain[0]!.publicKey, qeSignature), 'Invalid QE report signature');
  require(qeReport.subarray(128, 160).toString('hex') === INTEL_QE_MRSIGNER, 'Unexpected quoting enclave signer');
  const attestationKey = data.subarray(64, 128);
  require(sha('sha256', attestationKey, qeAuth).equals(qeReport.subarray(320, 352)) && qeReport.subarray(352, 384).every(b => b === 0), 'Attestation key not bound to QE report');
  require(ecdsa('sha256', signed, ecKey(attestationKey, 'P-256'), data.subarray(0, 64)), 'Invalid quote signature');
  return chain[2]!.fingerprint256;
}

function replayRtmr3(events: unknown, policy: ModelPolicy): string {
  require(Array.isArray(events), 'Missing event log');
  let rtmr: Buffer = Buffer.alloc(48), compose = false, image = false;
  for (const e of events as Array<{ imr: number; event_type: number; digest: string; event: string; event_payload: string }>) {
    if (e.imr !== 3) continue;
    const type = Buffer.alloc(4); type.writeUInt32LE(e.event_type);
    const payload = hexBytes(e.event_payload);
    const digest = sha('sha384', type, Buffer.from(':'), Buffer.from(e.event), Buffer.from(':'), payload);
    require(digest.toString('hex') === e.digest, 'Event log digest mismatch');
    if (e.event === 'compose-hash') compose = payload.toString('hex') === policy.compose_hash;
    if (e.event === 'os-image-hash') image = payload.toString('hex') === policy.os_image_hash;
    rtmr = sha('sha384', rtmr, digest);
  }
  require(compose && image, 'Model compose or OS image is not pinned');
  return rtmr.toString('hex');
}

function jwt(token: string, keys: Map<string, KeyObject>, nonce: string, nowSeconds: number) {
  const [h, p, s] = token.split('.');
  require(h && p && s, 'Invalid NRAS token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  const key = keys.get(header.kid);
  require(header.alg === 'ES384' && key && ecdsa('sha384', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url')), 'Invalid NRAS token signature');
  require(claims.iss === NRAS && claims.eat_nonce === nonce && claims.exp > nowSeconds && claims.nbf <= nowSeconds + 60, 'Stale or foreign NRAS token');
  return { kid: header.kid as string, claims };
}

async function json(url: string, init: RequestInit, max = 1_000_000): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const body = Buffer.from(await response.arrayBuffer());
  require(response.ok && body.length <= max, `Attestation service HTTP ${response.status}`);
  return JSON.parse(body.toString('utf8'));
}

export async function attestModel(apiKey: string, policy: ModelPolicy): Promise<{ evidence: ModelEvidence; raw: unknown }> {
  const nonce = randomBytes(32).toString('hex'), now = new Date();
  const url = `https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(policy.model)}&signing_algo=ed25519&nonce=${nonce}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  require(response.ok && bytes.length <= 1_000_000, `Model attestation HTTP ${response.status}`);
  const report = JSON.parse(bytes.toString('utf8')) as { model_attestations?: Array<Record<string, any>> };
  const errors: string[] = [];
  for (const a of (report.model_attestations ?? []).slice(0, 16)) {
    try {
      require(a.model_name === policy.model && a.signing_algo === 'ed25519' && a.request_nonce === nonce, 'Model identity or nonce mismatch');
      const key = hexBytes(a.signing_public_key, 32), quote = hexBytes(a.intel_quote), body = quote.subarray(48, 632);
      const root = verifyQuote(quote, now);
      require((body[120]! & 1) === 0, 'Debug TD is not allowed');
      require(body.subarray(520, 552).equals(key) && body.subarray(552, 584).toString('hex') === nonce, 'TDX report data does not bind model key and nonce');
      const field = (offset: number) => body.subarray(offset, offset + 48).toString('hex');
      require(field(136) === policy.mrtd && field(328) === policy.rtmr0 && field(376) === policy.rtmr1 && field(424) === policy.rtmr2
        && field(472) === replayRtmr3(a.info?.tcb_info?.event_log, policy), 'TDX measurements do not match model policy');
      const gpu = JSON.parse(a.nvidia_payload);
      require(gpu.nonce === nonce, 'GPU evidence nonce mismatch');
      const nras = await json(`${NRAS}/v3/attest/gpu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: a.nvidia_payload }) as [[string, string], Record<string, string>];
      const jwks = await json(`${NRAS}/.well-known/jwks.json`, {}, 2_000_000) as { keys: Array<JsonWebKey & { kid: string }> };
      const keys = new Map(jwks.keys.filter(k => k.kty === 'EC' && k.crv === 'P-384').map(k => [k.kid, createPublicKey({ format: 'jwk', key: k })]));
      const seconds = Math.floor(now.getTime() / 1000);
      require(Array.isArray(nras) && nras[0]?.[0] === 'JWT' && nras[1] && typeof nras[1] === 'object', 'Invalid NRAS response');
      const overall = jwt(nras[0][1], keys, nonce, seconds);
      require(overall.claims['x-nvidia-overall-att-result'] === true, 'GPU attestation failed');
      const gpus = Object.entries(nras[1]);
      require(gpus.length > 0 && gpus.length === Object.keys(overall.claims.submods ?? {}).length, 'GPU set mismatch');
      for (const [, token] of gpus) {
        const { claims } = jwt(token, keys, nonce, seconds);
        require(claims.measres === 'success' && claims.secboot === true && claims.dbgstat === 'disabled' && claims['x-nvidia-attestation-warning'] === null
          && Object.entries(claims).filter(([k]) => /^x-nvidia-.*-(verified|validated|match)$/.test(k)).every(([, v]) => v === true), 'GPU claims rejected');
      }
      return { raw: { report, nras }, evidence: {
        model: policy.model, signing_public_key: key.toString('hex'), nonce, report_sha256: sha('sha256', bytes).toString('hex'), verified_at: now.toISOString(),
        intel: { pck_chain_root_sha256: root, qe_mrsigner: INTEL_QE_MRSIGNER, quote_signature: true, report_data_binding: true, measurements: true },
        nvidia: { overall: true, gpus: gpus.map(([name]) => name), jwt_kid: overall.kid, expires: overall.claims.exp },
        not_checked: ['Intel TCB status and QE identity collateral', 'Intel PCK revocation lists', 'NVIDIA JWKS x5c chain (JWKS trusted via HTTPS)'],
      } };
    } catch (error) { errors.push(error instanceof Error ? error.message : 'attestation rejected'); }
  }
  throw new Error(`No model attestation satisfies policy: ${[...new Set(errors)].join('; ') || 'empty report'}`);
}
