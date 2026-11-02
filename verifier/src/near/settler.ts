import { verify } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, actions, type KeyPairString } from 'near-api-js';
import { canonical, verdictMessage, type Verdict } from '../../../protocol/index.ts';
import type { Settler } from '../interfaces.ts';
import { NearRpc } from './rpc.ts';
import { ed25519Key } from '../crypto.ts';
import { getProgram, getCommitment } from './programs.ts';
import { accountId, bytes32, object, text, verdict as parseVerdict } from './validation.ts';

const EXPIRY_MARGIN_BLOCKS = 20n;
export interface SettlementReceipt {
  transactionHash: string | null;
  receiptIds: string[];
  recoveredFromState: boolean;
  accepted: boolean;
  payout: 'not-applicable' | 'pending' | 'retryable' | 'paid';
  finalizedBlock: string;
  reference: string;
}
export interface NearSettlerOptions {
  contract: string;
  signerAccount: string;
  privateKey: string;
  allowMainnet?: boolean;
}
export class NearSettler implements Settler {
  private account: Account;
  private provider: JsonRpcProvider;
  private serial: Promise<unknown> = Promise.resolve();
  constructor(
    private rpc: NearRpc,
    private options: NearSettlerOptions,
  ) {
    accountId(options.contract);
    accountId(options.signerAccount);
    if (rpc.network === 'mainnet' && !options.allowMainnet)
      throw new Error('Mainnet writes require explicit configuration');
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/.test(options.privateKey))
      throw new Error('Expected NEAR ed25519 private key');
    this.provider = new JsonRpcProvider({ url: rpc.url }, { retries: 1, wait: 500, backoff: 1 });
    try {
      this.account = new Account(
        options.signerAccount,
        this.provider,
        options.privateKey as KeyPairString,
      );
    } catch {
      throw new Error('Invalid transaction signing key');
    }
    this.ready = this.validateAccessKey();
  }
  private ready: Promise<void>;
  private async validateAccessKey(): Promise<void> {
    const publicKey = KeyPair.fromString(this.options.privateKey as KeyPairString)
      .getPublicKey()
      .toString();
    const listed = await this.provider.viewAccessKeyList({
      accountId: this.options.signerAccount,
      finalityQuery: { finality: 'final' },
    });
    const match = listed.keys.find((entry) => entry.public_key === publicKey);
    if (!match) throw new Error('Settlement key is not registered on signer account');
    const permission = match.access_key.permission as unknown;
    if (permission === 'FullAccess') return;
    if (!permission || typeof permission !== 'object' || !('FunctionCall' in permission))
      throw new Error('Unsupported settlement access key permission');
    const fc = (permission as { FunctionCall: { receiver_id: string; method_names: string[] } })
      .FunctionCall;
    if (
      fc.receiver_id !== this.options.contract ||
      (fc.method_names.length > 0 && !fc.method_names.includes('settle'))
    )
      throw new Error('Settlement function-call key must allow settle on configured contract');
  }
  async settle(verdict: Verdict, signature: Uint8Array): Promise<string> {
    return (await this.settleDetailed(verdict, signature)).reference;
  }
  settleDetailed(verdict: Verdict, signature: Uint8Array): Promise<SettlementReceipt> {
    const task = this.serial.then(() => this.perform(verdict, signature));
    this.serial = task.catch(() => undefined);
    return task;
  }
  private async perform(input: Verdict, signature: Uint8Array): Promise<SettlementReceipt> {
    await this.ready;
    const v = parseVerdict(input);
    if (v.network !== this.rpc.network || v.contract !== this.options.contract)
      throw new Error('Settlement domain mismatch');
    const snapshot = await this.rpc.snapshot();
    const config = object(
      await this.rpc.view(v.contract, 'get_config', {}, snapshot),
      'contract config',
    );
    if (config.network !== v.network || config.protocol_version !== '1')
      throw new Error('Settlement contract mismatch');
    const [program, claim] = await Promise.all([
      getProgram(this.rpc, v.contract, v.bounty, snapshot),
      getCommitment(this.rpc, v.contract, v, snapshot),
    ]);
    if (program.rules_hash !== v.rules_hash || claim.report_hash !== v.report_hash)
      throw new Error('Settlement rules/commitment mismatch');
    const key = ed25519Key(bytes32(program.verifier.public_key, 'signer key'));
    if (signature.length !== 64 || !verify(null, verdictMessage(v), key, signature))
      throw new Error('Invalid verdict signature');
    if (claim.settled) {
      if (!claim.verdict || canonical(claim.verdict) !== canonical(v))
        throw new Error('Claim settled with different or unavailable verdict');
      return this.receipt(v, program.state, snapshot.hash, null, [], true);
    }
    if (
      program.state !== 'Available' ||
      BigInt(v.expires) < snapshot.height + EXPIRY_MARGIN_BLOCKS ||
      BigInt(v.expires) > BigInt(program.settle_until)
    )
      throw new Error('Settlement unavailable or expired');
    let result: unknown;
    try {
      result = await this.account.signAndSendTransaction({
        receiverId: v.contract,
        actions: [
          actions.functionCall(
            'settle',
            { verdict: v, signature: Buffer.from(signature).toString('base64') },
            100_000_000_000_000n,
            0n,
          ),
        ],
        waitUntil: 'FINAL',
        throwOnFailure: false,
        retries: 0,
      });
    } catch {
      throw new Error('Settlement outcome unknown; retry the same signed verdict to reconcile');
    }
    const response = object(result, 'transaction result');
    const outcome = object(response.final_execution_outcome ?? response, 'execution outcome');
    const status = object(outcome.status, 'transaction status');
    if ('Failure' in status) throw new Error('Settlement transaction rejected on chain');
    if (!('SuccessValue' in status))
      throw new Error('Settlement transaction not finalized successfully');
    const transaction = object(outcome.transaction, 'transaction');
    const transactionHash = text(transaction.hash, 'transaction hash');
    const receiptIds = Array.isArray(outcome.receipts_outcome)
      ? outcome.receipts_outcome.map((r) => text(object(r, 'receipt').id, 'receipt ID'))
      : [];
    const after = await this.rpc.snapshot();
    const [finalProgram, finalClaim] = await Promise.all([
      getProgram(this.rpc, v.contract, v.bounty, after),
      getCommitment(this.rpc, v.contract, v, after),
    ]);
    if (
      !finalClaim.settled ||
      !finalClaim.verdict ||
      canonical(finalClaim.verdict) !== canonical(v)
    )
      throw new Error('Settlement acceptance not yet visible; retry same verdict');
    return this.receipt(v, finalProgram.state, after.hash, transactionHash, receiptIds, false);
  }
  private receipt(
    v: Verdict,
    state: string,
    block: string,
    tx: string | null,
    receipts: string[],
    recovered: boolean,
  ): SettlementReceipt {
    const payout = !v.valid
      ? 'not-applicable'
      : state === 'Paid'
        ? 'paid'
        : state === 'Retryable'
          ? 'retryable'
          : 'pending';
    return {
      transactionHash: tx,
      receiptIds: receipts,
      recoveredFromState: recovered,
      accepted: true,
      payout,
      finalizedBlock: block,
      reference: tx
        ? `near:${v.network}:transaction:${tx}`
        : `near:${v.network}:state:${v.contract}:${v.bounty}:${v.hunter}:${v.submission}`,
    };
  }
}
