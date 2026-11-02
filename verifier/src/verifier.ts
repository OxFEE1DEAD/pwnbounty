import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Attestation, BountyId, Disclosure, Enclave, Judge, SealedReport, Settler, Verdict, Verifier } from "./interfaces.ts";

const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();
const raw = (key: KeyObject) => key.export({ format: "der", type: "spki" }).subarray(-32);
const x25519 = (bytes: Uint8Array) => createPublicKey({ key: Buffer.concat([X25519_SPKI, bytes]), format: "der", type: "spki" });

export const verdictMessage = (verdict: Verdict) =>
  sha256(JSON.stringify({ bounty: verdict.bounty, report_hash: verdict.report_hash, hunter: verdict.hunter, valid: verdict.valid, disclosure_hash: verdict.disclosure_hash }));

export function seal(plaintext: Uint8Array, recipient: Uint8Array): Uint8Array {
  const ephemeral = generateKeyPairSync("x25519");
  const key = sha256(diffieHellman({ privateKey: ephemeral.privateKey, publicKey: x25519(recipient) }));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([raw(ephemeral.publicKey), iv, cipher.getAuthTag(), body]);
}

export class LocalEnclave implements Enclave {
  private readonly box = generateKeyPairSync("x25519");
  private readonly signer: KeyObject;

  constructor(signerPkcs8?: string) {
    this.signer = signerPkcs8 ? createPrivateKey({ key: Buffer.from(signerPkcs8, "base64"), format: "der", type: "pkcs8" }) : generateKeyPairSync("ed25519").privateKey;
  }

  async attestation(): Promise<Attestation> {
    return { publicKey: raw(createPublicKey(this.signer)), quote: new Uint8Array() };
  }

  boxKey(): Uint8Array {
    return raw(this.box.publicKey);
  }

  async open