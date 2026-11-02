import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, actions, type KeyPairString } from 'near-api-js';
import { ENGINE } from '../../../protocol/program.ts';
import type {
  Action,
  Call,
  Code,
  ProgramSpec,
  ReceiptOutcome,
  Role,
  RunEvidence,
  Snapshot,
  TxAttack,
  View,
} from '../../../protocol/program.ts';
import type { WorldFactory, WorldHandle } from '../interfaces.ts';
import { startNode, type Node } from './node.ts';

type Status = RunEvidence['status'];
type AnyAction = ReturnType<typeof actions.transfer>;
type Act = {
  CreateAccount?: object;
  Transfer?: { deposit: string };
  FunctionCall?: { args: string };
};
type Detail = {
  receipt_id: string;
  predecessor_id: string;
  receiver_id: string;
  receipt: { Action?: { actions: (Act | string)[] } };
};

const SETUP_GAS = 300_000_000_000_000n;
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const MENTION_KEYS = ['account_id', 'receiver_id', 'owner_id', 'beneficiary_id', 'recipient'];

const CHAIN_REJECTIONS = ['INVALID_TRANSACTION', 'UNKNOWN_ACCESS_KEY', 'UNKNOWN_ACCOUNT'];

type RpcError = { cause?: { name?: string } };

class Invalid extends Error {}
class Limit extends Error {}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export class SandboxWorlds implements WorldFactory {
  constructor(
    private bin: string,
    private code: (code: Code) => Promise<Uint8Array>,
  ) {}
  async create(spec: ProgramSpec): Promise<WorldHandle> {
    const node = await startNode(this.bin, ENGINE.epochLength);
    try {
      return await SandboxWorld.build(node, spec, this.code);
    } catch (e) {
      await node.stop();
      throw e;
    }
  }
}

class SandboxWorld implements WorldHandle {
  roles: Record<string, Role> = {};
  attackerKeys: string[] = [];
  private known = new Set<string>();
  private granted = new Set<string>();
  private signers = new Map<string, KeyPair>();
  private keys: KeyPair[] = [];
  private attacker = '';
  private provider: JsonRpcProvider;

  private constructor(
    private node: Node,
    private spec: ProgramSpec,
    private codes: Map<string, Uint8Array>,
  ) {
    this.provider = new JsonRpcProvider({ url: node.rpcUrl });
  }

  static async build(node: Node, spec: ProgramSpec, load: (code: Code) => Promise<Uint8Array>) {
    const codes = new Map<string, Uint8Array>();
    for (const code of spec.codes) {
      const bytes = await load(code);
      if (sha256(bytes) !== code.sha256) throw new Error(`Code hash mismatch ${code.sha256}`);
      codes.set(code.sha256, bytes);
    }
    const world = new SandboxWorld(node, spec, codes);
    await world.setup();
    return world;
  }

  private async setup() {
    const root = this.node.root.accountId;
    const rootAccount = new Account(root, this.provider, this.node.root.secretKey as KeyPairString);
    for (const id of [root, 'near']) {
      this.roles[id] = 'system';
      this.known.add(id);
    }
    this.keys = Array.from({ length: this.spec.attackerKeys }, () => KeyPair.fromRandom('ed25519'));
    this.attackerKeys = this.keys.map((k) => k.getPublicKey().toString());
    for (const key of this.keys) {
      this.roles[implicit(key)] = 'attacker';
      this.known.add(implicit(key));
    }
    const harness = KeyPair.fromRandom('ed25519');
    for (const step of this.spec.steps) {
      if (step.op === 'account') {
        const key = step.role === 'attacker' ? this.key('key:0') : harness;
        if (step.role === 'attacker') this.attacker = step.id;
        await rootAccount.signAndSendTransaction({
          receiverId: step.id,
          actions: [
            actions.createAccount(),
            actions.transfer(BigInt(step.near)),
            actions.addFullAccessKey(key.getPublicKey()),
          ],
          waitUntil: 'FINAL',
        });
        this.roles[step.id] = step.role;
        this.known.add(step.id);
        this.signers.set(step.id, key);
      } else if (step.op === 'deploy') {
        const list = [actions.deployContract(this.bytes(step.code))];
        if (step.init)
          list.push(actions.functionCall(step.init.method, args(step.init.args), SETUP_GAS, 0n));
        await this.signer(step.id).signAndSendTransaction({
          receiverId: step.id,
          actions: list,
          waitUntil: 'FINAL',
        });
      } else if (step.op === 'key') {
        await this.signer(step.id).signAndSendTransaction({
          receiverId: step.id,
          actions: [
            this.action({ type: 'AddKey', key: step.key, permission: step.permission }, {}),
          ],
          waitUntil: 'FINAL',
        });
        this.granted.add(step.id);
      } else {
        await this.signer(step.call.signer).signAndSendTransaction({
          receiverId: step.call.receiver,
          actions: [fnCall(step.call)],
          waitUntil: 'FINAL',
        });
      }
    }
    if (!this.attacker || !this.keys.length) throw new Error('Program has no attacker');
  }

  private bytes(sha: string) {
    const code = this.codes.get(sha);
    if (!code) throw new Invalid(`Unknown code ${sha}`);
    return code;
  }

  private signer(id: string) {
    const key = this.signers.get(id);
    if (!key || this.roles[id] === 'attacker') throw new Error(`No harness key for ${id}`);
    return new Account(id, this.provider, key.toString() as KeyPairString);
  }

  private resolve(ref: string, aliases: Record<string, string>): string {
    if (ref === 'attacker') return this.attacker;
    const alias = aliases[ref];
    if (alias) return alias;
    const m = /^implicit:key:(\d+)$/.exec(ref);
    if (m) return implicit(this.key(`key:${m[1]}`));
    if (!ACCOUNT.test(ref) || ref.length < 2 || ref.length > 64)
      throw new Invalid(`Bad account ${ref}`);
    return ref;
  }

  private key(ref: string): KeyPair {
    const m = /^key:(\d+)$/.exec(ref);
    const key = m ? this.keys[Number(m[1])] : undefined;
    if (!key) throw new Invalid(`Bad key ${ref}`);
    return key;
  }

  private action(a: Action, aliases: Record<string, string>): AnyAction {
    switch (a.type) {
      case 'FunctionCall':
        return actions.functionCall(a.method, args(a.args), BigInt(a.gas), BigInt(a.deposit));
      case 'Transfer':
        return actions.transfer(BigInt(a.deposit));
      case 'CreateAccount':
        return actions.createAccount();
      case 'AddKey':
        return a.permission === 'full'
          ? actions.addFullAccessKey(this.key(a.key).getPublicKey())
          : actions.addFunctionCallAccessKey(
              this.key(a.key).getPublicKey(),
              this.resolve(a.permission.receiver, aliases),
              a.permission.methods,
              a.permission.allowance === null ? undefined : BigInt(a.permission.allowance),
            );
      case 'DeleteKey':
        return actions.deleteKey(this.key(a.key).getPublicKey());
      case 'DeleteAccount':
        return actions.deleteAccount(this.resolve(a.beneficiary, aliases));
      case 'DeployContract':
        return actions.deployContract(this.bytes(a.code));
      default:
        throw new Invalid('Unsupported action');
    }
  }

  async send(attack: TxAttack): Promise<{ receipts: ReceiptOutcome[]; status: Status }> {
    const limits = this.spec.limits;
    const receipts: ReceiptOutcome[] = [];
    const deadline = Date.now() + limits.wallMs;
    let built: { signer: string; key: KeyPair; receiver: string; list: AnyAction[] }[];
    try {
      const aliases = Object.fromEntries(
        Object.entries(attack.accounts ?? {}).map(([alias, id]) => {
          if (!id.endsWith(`.${this.attacker}`))
            throw new Invalid(`Alias ${alias} outside attacker`);
          return [alias, id];
        }),
      );
      if (!Array.isArray(attack.txs)) throw new Invalid('No txs');
      if (attack.txs.length > limits.txs) throw new Limit('Too many txs');
      if (Object.keys(aliases).length > limits.newAccounts) throw new Limit('Too many accounts');
      let gas = 0n;
      built = attack.txs.map((tx) => {
        if (!Array.isArray(tx.actions)) throw new Invalid('No actions');
        if (tx.actions.length > limits.actionsPerTx) throw new Limit('Too many actions');
        const txGas = tx.actions.reduce(
          (sum, a) => sum + (a.type === 'FunctionCall' ? BigInt(a.gas) : 0n),
          0n,
        );
        if (txGas > BigInt(limits.gasPerTx)) throw new Limit('Gas per tx over limit');
        gas += txGas;
        const signer = this.resolve(tx.signerAccount, aliases);
        const fixed = this.roles[signer];
        if (fixed && fixed !== 'attacker' && !this.granted.has(signer))
          throw new Invalid(`Signer ${signer} is not attacker`);
        return {
          signer,
          key: this.key(tx.signingKey),
          receiver: this.resolve(tx.receiver, aliases),
          list: tx.actions.map((a) => this.action(a, aliases)),
        };
      });
      if (gas > BigInt(limits.gasTotal)) throw new Limit('Total gas over limit');
    } catch (e) {
      if (e instanceof Limit) return { receipts, status: 'limit' };
      if (e instanceof Invalid || e instanceof SyntaxError || e instanceof TypeError)
        return { receipts, status: 'invalid_attack' };
      throw e;
    }
    for (const tx of built) {
      if (Date.now() > deadline) return { receipts, status: 'limit' };
      receipts.push(...(await this.execute(tx.signer, tx.key, tx.receiver, tx.list)));
      if (receipts.length > limits.receipts) return { receipts, status: 'limit' };
    }
    return { receipts, status: 'complete' };
  }

  private async execute(signer: string, key: KeyPair, receiver: string, list: AnyAction[]) {
    const access = await this.rpcBody('query', {
      request_type: 'view_access_key',
      finality: 'final',
      account_id: signer,
      public_key: key.getPublicKey().toString(),
    });
    if (access.error) return rejected(access.error);
    const account = new Account(signer, this.provider, key.toString() as KeyPairString);
    const signed = await account.createSignedTransaction({ receiverId: receiver, actions: list });
    const sent = await this.rpcBody('send_tx', {
      signed_tx_base64: Buffer.from(signed.encode()).toString('base64'),
      wait_until: 'FINAL',
    });
    if (sent.error) return rejected(sent.error);
    const hash = (sent.result as { transaction_outcome: { id: string } }).transaction_outcome.id;
    const full = await this.provider.viewTransactionStatusWithReceipts({
      txHash: hash,
      accountId: signer,
      waitUntil: 'FINAL',
    });
    const details = new Map(
      ((full as { receipts?: Detail[] }).receipts ?? []).map((r) => [r.receipt_id, r]),
    );
    return full.receipts_outcome.map((o): ReceiptOutcome => {
      const detail = details.get(o.id);
      const acts = detail?.receipt.Action?.actions ?? [];
      const creates = acts.some((a) => a === 'CreateAccount' || (a as Act).CreateAccount);
      const mentioned = new Set<string>([o.outcome.executor_id]);
      if (creates && detail) mentioned.add(detail.receiver_id);
      let deposit = 0n;
      for (const act of acts as Act[]) {
        if (act.Transfer) deposit += BigInt(act.Transfer.deposit);
        if (act.FunctionCall) for (const id of mentions(act.FunctionCall.args)) mentioned.add(id);
      }
      return {
        receipt: o.id,
        tx: hash,
        predecessor: detail?.predecessor_id ?? signer,
        receiver: detail?.receiver_id ?? o.outcome.executor_id,
        ok: !('Failure' in (o.outcome.status as object)),
        burnt: String(o.outcome.tokens_burnt),
        deposit: deposit.toString(),
        created: creates && detail ? [detail.receiver_id] : [],
        mentioned: [...mentioned].filter((id) => ACCOUNT.test(id)),
      };
    });
  }

  async call(call: Call): Promise<ReceiptOutcome[]> {
    return this.execute(call.signer, this.signers.get(call.signer)!, call.receiver, [fnCall(call)]);
  }

  async view(view: View, block?: number): Promise<string> {
    const r = await this.rpc('query', {
      request_type: 'call_function',
      ...(block === undefined ? { finality: 'final' } : { block_id: block }),
      account_id: view.contract,
      method_name: view.method,
      args_base64: Buffer.from(JSON.stringify(view.args)).toString('base64'),
    });
    return Buffer.from(r.result as number[]).toString('utf8');
  }

  async snapshot(mentioned: string[]): Promise<Snapshot> {
    for (const id of mentioned) if (ACCOUNT.test(id)) this.known.add(id);
    let last: Snapshot | undefined;
    for (let i = 0; i < 30; i++) {
      last = await this.read();
      const native = Object.values(last.native).reduce(
        (s, a) => s + BigInt(a.amount) + BigInt(a.locked),
        0n,
      );
      if (native === BigInt(last.totalSupply)) return last;
      await new Promise((r) => setTimeout(r, 300));
    }
    return last!;
  }

  private async read(): Promise<Snapshot> {
    const block = await this.provider.viewBlock({ finality: 'final' });
    const height = block.header.height;
    const snap: Snapshot = {
      height: String(height),
      totalSupply: block.header.total_supply,
      native: {},
      holdings: [],
      supplies: {},
      keys: {},
    };
    for (const id of this.known) {
      const account = await this.rpc('query', {
        request_type: 'view_account',
        block_id: height,
        account_id: id,
      }).catch(() => null);
      if (!account) continue;
      snap.native[id] = { amount: account.amount as string, locked: account.locked as string };
      const keys = await this.rpc('query', {
        request_type: 'view_access_key_list',
        block_id: height,
        account_id: id,
      });
      snap.keys[id] = (
        keys.keys as { public_key: string; access_key: { permission: unknown } }[]
      ).map((k) => ({ key: k.public_key, full: k.access_key.permission === 'FullAccess' }));
    }
    for (const token of this.spec.tokens) {
      snap.supplies[token.contract] = JSON.parse(
        await this.view({ contract: token.contract, method: 'ft_total_supply', args: {} }, height),
      );
      for (const id of this.known) {
        const amount = JSON.parse(
          await this.view(
            { contract: token.contract, method: 'ft_balance_of', args: { account_id: id } },
            height,
          ),
        ) as string;
        if (amount !== '0') snap.holdings.push({ account: id, token: token.contract, amount });
      }
    }
    return snap;
  }

  async forward(blocks: number): Promise<void> {
    const start = (await this.provider.viewBlock({ finality: 'final' })).header.height;
    await this.rpc('sandbox_fast_forward', { delta_height: blocks });
    for (let i = 0; i < 600; i++) {
      if ((await this.provider.viewBlock({ finality: 'final' })).header.height >= start + blocks)
        return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  height(): Promise<number> {
    return this.provider.viewBlock({ finality: 'final' }).then((b) => b.header.height);
  }

  stop() {
    return this.node.stop();
  }

  private async rpcBody(method: string, params: object) {
    const response = await fetch(this.node.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await response.json()) as { result?: Record<string, any>; error?: RpcError };
  }

  private async rpc(method: string, params: object): Promise<Record<string, any>> {
    const body = await this.rpcBody(method, params);
    if (body.error || !body.result) throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
}

function rejected(error: RpcError): ReceiptOutcome[] {
  if (CHAIN_REJECTIONS.includes(error.cause?.name ?? '')) return [];
  throw new Error(`RPC: ${JSON.stringify(error)}`);
}

function implicit(key: KeyPair) {
  return Buffer.from(key.getPublicKey().data).toString('hex');
}

function args(value: unknown) {
  return Buffer.from(JSON.stringify(value));
}

function fnCall(call: Call) {
  return actions.functionCall(call.method, args(call.args), BigInt(call.gas), BigInt(call.deposit));
}

function mentions(encoded: string): string[] {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const found: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          if (MENTION_KEYS.includes(k) && typeof x === 'string') found.push(x);
          walk(x);
        }
    };
    walk(parsed);
    return found;
  } catch {
    return [];
  }
}
