import { canonical, digest } from './index.ts';

export type Yocto = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Role = 'attacker' | 'protected' | 'neutral' | 'system';

export type Code =
  | {
      source: 'chain-code';
      network: 'mainnet' | 'testnet';
      account: string;
      block: string;
      sha256: string;
    }
  | { source: 'wasm'; sha256: string };

export interface Call {
  signer: string;
  receiver: string;
  method: string;
  args: Json;
  deposit: Yocto;
  gas: string;
}

export interface View {
  contract: string;
  method: string;
  args: Json;
}

export type Step =
  | { op: 'account'; id: string; near: Yocto; role: Role }
  | { op: 'deploy'; id: string; code: string; init?: { method: string; args: Json } }
  | { op: 'call'; call: Call }
  | { op: 'key'; id: string; key: string; permission: KeyPermission };

export interface Token {
  contract: string;
  rate: Yocto;
}

export type Rule =
  | { id: 'take'; threshold: Yocto }
  | { id: 'loss'; threshold: Yocto }
  | {
      id: 'block';
      victim: Call;
      claim: View;
      expect: { account: string; token: string; amount: Yocto };
    };

export interface Limits {
  txs: number;
  actionsPerTx: number;
  gasPerTx: string;
  gasTotal: string;
  receipts: number;
  newAccounts: number;
  wallMs: number;
  bytes: number;
}

export interface ProgramSpec {
  version: '2';
  title: string;
  codes: Code[];
  steps: Step[];
  tokens: Token[];
  attackerKeys: number;
  privileged: { account: string; role: string }[];
  rules: Rule[];
  limits: Limits;
}

export type KeyPermission =
  'full' | { receiver: string; methods: string[]; allowance: Yocto | null };

export type Action =
  | { type: 'FunctionCall'; method: string; args: Json; deposit: Yocto; gas: string }
  | { type: 'Transfer'; deposit: Yocto }
  | { type: 'CreateAccount' }
  | {
      type: 'AddKey';
      key: string;
      permission: KeyPermission;
    }
  | { type: 'DeleteKey'; key: string }
  | { type: 'DeleteAccount'; beneficiary: string }
  | { type: 'DeployContract'; code: string };

export interface AttackTx {
  signerAccount: string;
  signingKey: string;
  receiver: string;
  actions: Action[];
}

export interface TxAttack {
  accounts: Record<string, string>;
  txs: AttackTx[];
}

export type Outcome =
  'violation' | 'no_violation' | 'limit' | 'invalid_attack' | 'inconclusive' | 'infra_error';

export interface Holding {
  account: string;
  token: string;
  amount: string;
}

export interface Snapshot {
  height: string;
  totalSupply: Yocto;
  native: Record<string, { amount: Yocto; locked: Yocto }>;
  holdings: Holding[];
  supplies: Record<string, string>;
  keys: Record<string, { key: string; full: boolean }[]>;
}

export interface ReceiptOutcome {
  receipt: string;
  tx: string;
  predecessor: string;
  receiver: string;
  ok: boolean;
  burnt: Yocto;
  deposit: Yocto;
  created: string[];
  mentioned: string[];
}

export interface VictimResult {
  ok: boolean;
  received: Yocto;
  entitlement: string;
}

export interface RunEvidence {
  spec: ProgramSpec;
  roles: Record<string, Role>;
  attackerKeys: string[];
  before: Snapshot;
  after: Snapshot;
  receipts: ReceiptOutcome[];
  status: 'complete' | 'limit' | 'invalid_attack' | 'pending' | 'infra_error';
  attacked?: VictimResult;
  control?: VictimResult;
}

export interface Judgement {
  outcome: Outcome;
  rule?: Rule['id'];
  deltas: Holding[];
}

export const ENGINE = { judge: '1', executor: '1', sandbox: '2.13.4', epochLength: 100000 };

export const programHash = (spec: ProgramSpec) => digest(canonical({ spec, engine: ENGINE }));
