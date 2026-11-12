import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { readLimited } from './chain.js';
import { digest } from './crypto.js';
import { errorText, useEnv } from './env.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';
import { repository } from './landing.js';
import { readAbi, wasmMethods, type Methods, type Param } from './abi.js';
import { download, programDigest, targets, type Spec } from './checks.js';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Role = 'attacker' | 'protected' | 'neutral' | 'system';
type Code =
  | {
      source: 'chain-code';
      network: 'mainnet' | 'testnet';
      account: string;
      block: string;
      sha256: string;
    }
  | { source: 'wasm'; sha256: string };
type Call = {
  signer: string;
  receiver: string;
  method: string;
  args: Json;
  deposit: string;
  gas: string;
};
type Permission = 'full' | { receiver: string; methods: string[]; allowance: string | null };
type Step =
  | { op: 'account'; id: string; near: string; role: Role }
  | { op: 'deploy'; id: string; code: string; init?: { method: string; args: Json } }
  | { op: 'call'; call: Call }
  | { op: 'key'; id: string; key: string; permission: Permission };
type Block = {
  id: 'block';
  victim: Call;
  claim: { contract: string; method: string; args: Json };
  expect: { account: string; token: string; amount: string };
};
type Rule = { id: 'take' | 'loss'; threshold: string } | Block;
type Limits = {
  txs: number;
  actionsPerTx: number;
  gasPerTx: string;
  gasTotal: string;
  receipts: number;
  newAccounts: number;
  wallMs: number;
  bytes: number;
};
type Program = {
  version: '2';
  title: string;
  codes: Code[];
  steps: Step[];
  tokens: { contract: string; rate: string }[];
  attackerKeys: number;
  privileged: { account: string; role: string }[];
  rules: Rule[];
  limits: Limits;
};
type Source = { code: Code; label: string; file?: string; methods: Methods };
type Problem = [string, Record<string, string>?];
interface Scope {
  accounts: string[];
  signers: string[];
  contracts: string[];
  keys: string[];
  sources: Record<string, Source>;
  methodsOf(account: string): Methods;
  decimalsOf(account: string): number;
}

const NEAR = 24;
const YOCTO = 10n ** 24n;
const TGAS = 10n ** 12n;
const STORAGE = '1250000000000000000000';
const ONE_YOCTO = /^(ft|nft)_transfer(_call)?$/;
const strings = (...names: string[]) => names.map((name) => ({ name, type: 'string', text: true }));
const standard: Record<string, Param[]> = {
  ft_transfer: strings('receiver_id', 'amount', 'memo'),
  ft_transfer_call: strings('receiver_id', 'amount', 'memo', 'msg'),
  nft_transfer: strings('receiver_id', 'token_id'),
  nft_transfer_call: strings('receiver_id', 'token_id', 'msg'),
  storage_deposit: strings('account_id'),
};
const ACCOUNT = /^[a-z0-9]+(?:[-_][a-z0-9]+)*\.test\.near$/;
const FLOOR = '100000000000000000000000';
const roles: Role[] = ['protected', 'neutral'];
const rpcs = { mainnet: 'https://free.rpc.fastnear.com', testnet: 'https://test.rpc.fastnear.com' };
const sandbox =
  'https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/2.13.4/near-sandbox.tar.gz';
const limitFields: [keyof Limits, string, boolean][] = [
  ['txs', 'Transactions', false],
  ['actionsPerTx', 'Actions per transaction', false],
  ['gasPerTx', 'Gas per transaction, TGas', true],
  ['gasTotal', 'Gas in total, TGas', true],
  ['receipts', 'Receipts', false],
  ['newAccounts', 'New accounts', false],
  ['wallMs', 'Time, ms', false],
  ['bytes', 'Attack size, bytes', false],
];

const nearOf = (amount: number) => (BigInt(amount) * YOCTO).toString();
const gasOf = (tera: number) => (BigInt(tera) * TGAS).toString();
const toUnits = (decimals: number) => (value: string) => {
  const match = /^(\d{1,30})(?:\.(\d*))?$/.exec(value.trim());
  const fraction = match?.[2] ?? '';
  if (!match || fraction.length > decimals) return undefined;
  const scale = 10n ** BigInt(decimals);
  return (BigInt(match[1]!) * scale + BigInt(fraction.padEnd(decimals, '0') || '0')).toString();
};
const fromUnits = (decimals: number) => (value: string) => {
  const amount = BigInt(value);
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${amount / scale}${fraction ? '.' + fraction : ''}`;
};
const toNear = fromUnits(NEAR);
const toGas = (value: string) =>
  /^\d{1,4}$/.test(value.trim()) ? (BigInt(value.trim()) * TGAS).toString() : undefined;
const unitsOf = (
  unit: 'tgas' | number,
): [(value: string) => string | undefined, (value: string) => string] =>
  unit === 'tgas'
    ? [toGas, (value: string) => (BigInt(value) / TGAS).toString()]
    : [toUnits(unit), fromUnits(unit)];

const blank = (): Program => ({
  version: '2',
  title: '',
  codes: [],
  steps: [
    { op: 'account', id: 'app.test.near', near: nearOf(10), role: 'protected' },
    { op: 'deploy', id: 'app.test.near', code: '' },
    { op: 'account', id: 'alice.test.near', near: nearOf(100), role: 'protected' },
    { op: 'account', id: 'hunter.test.near', near: nearOf(20), role: 'attacker' },
  ],
  tokens: [],
  attackerKeys: 1,
  privileged: [],
  rules: [
    { id: 'take', threshold: FLOOR },
    { id: 'loss', threshold: FLOOR },
  ],
  limits: {
    txs: 4,
    actionsPerTx: 8,
    gasPerTx: gasOf(300),
    gasTotal: gasOf(1000),
    receipts: 64,
    newAccounts: 4,
    wallMs: 30000,
    bytes: 16384,
  },
});

function sourcesOf(codes: Code[], methods: Record<string, string[]> = {}): Record<string, Source> {
  return Object.fromEntries(
    codes.map((code) => [
      code.sha256,
      {
        code,
        label:
          code.source === 'wasm'
            ? 'template build'
            : `${code.account} @ ${code.block} · ${code.network}`,
        methods: Object.fromEntries((methods[code.sha256] ?? []).map((name) => [name, {}])),
      },
    ]),
  );
}

async function query(network: keyof typeof rpcs, params: Record<string, string>) {
  const response = await fetch(rpcs[network], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'query',
      method: 'query',
      params: { finality: 'final', ...params },
    }),
    signal: AbortSignal.timeout(30000),
  });
  return JSON.parse(new TextDecoder().decode(await readLimited(response, 8_388_608)))?.result;
}

async function ftDecimals(code: Code): Promise<number | undefined> {
  if (code.source !== 'chain-code') return undefined;
  const result = await query(code.network, {
    request_type: 'call_function',
    account_id: code.account,
    method_name: 'ft_metadata',
    args_base64: btoa('{}'),
  });
  const decimals = JSON.parse(String.fromCharCode(...(result?.result ?? []))).decimals;
  return Number.isInteger(decimals) && decimals <= NEAR ? decimals : undefined;
}

async function chainCode(account: string): Promise<Source> {
  const network = account.endsWith('.testnet') ? 'testnet' : 'mainnet';
  const result = (await query(network, { request_type: 'view_code', account_id: account })) as
    { code_base64?: string; block_height?: number } | undefined;
  if (!result?.code_base64) throw new Error('No contract is deployed on this account');
  const bytes = Uint8Array.from(atob(result.code_base64), (c) => c.charCodeAt(0));
  const block = String(result.block_height);
  return {
    code: { source: 'chain-code', network, account, block, sha256: await digest(bytes) },
    label: `${account} @ ${block} · ${network}`,
    methods: wasmMethods(bytes),
  };
}

async function wasmFile(file: File): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const methods = wasmMethods(bytes);
  return {
    code: { source: 'wasm', sha256: await digest(bytes) },
    label: file.name,
    file: file.name,
    methods,
  };
}

function check(program: Program, sources: Record<string, Source>): Problem[] {
  const out: Problem[] = [];
  const made = new Map<string, Role>();
  const ready = (id: string, signer = false) =>
    made.has(id) && !(signer && made.get(id) === 'attacker');
  if (!program.title.trim()) out.push(['Give the program a name']);
  program.steps.forEach((step, index) => {
    const n = String(index + 1);
    if (step.op === 'account') {
      if (!ACCOUNT.test(step.id) || step.id.length > 64)
        out.push(['Step {n}: account names look like name.test.near', { n }]);
      if (made.has(step.id)) out.push(['Step {n}: {id} is created twice', { n, id: step.id }]);
      made.set(step.id, step.role);
    } else if (step.op === 'deploy' || step.op === 'key') {
      if (!ready(step.id, true))
        out.push(['Step {n}: create {id} earlier, not as the attacker', { n, id: step.id }]);
      if (step.op === 'deploy' && !sources[step.code])
        out.push(['Step {n}: choose the code for {id}', { n, id: step.id }]);
      if (step.op === 'key' && Number(step.key.slice(4)) >= program.attackerKeys)
        out.push(['Step {n}: the attacker has fewer keys', { n }]);
      if (step.op === 'key' && step.permission !== 'full' && !ready(step.permission.receiver))
        out.push(['Step {n}: the key contract is not created earlier', { n }]);
    } else {
      if (!ready(step.call.signer, true) || !ready(step.call.receiver))
        out.push(['Step {n}: the signer and the contract must be created earlier', { n }]);
      if (!step.call.method) out.push(['Step {n}: choose a method', { n }]);
    }
  });
  if ([...made.values()].filter((role) => role === 'attacker').length !== 1)
    out.push(['Make exactly one attacker account']);
  if (!program.rules.length) out.push(['Pick at least one rule']);
  const block = program.rules.find((rule): rule is Block => rule.id === 'block');
  if (block && (!ready(block.victim.signer, true) || !block.victim.method || !block.claim.method))
    out.push(['Fill in the withdrawal check']);
  for (const token of program.tokens)
    if (!made.has(token.contract))
      out.push(['Token {id} is not created in the setup', { id: token.contract }]);
  return out;
}

function keep(args: Json, params?: Param[]): Json {
  if (!params || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).filter(([name]) => params.some((param) => param.name === name)),
  );
}

function argValue(input: string, text: boolean): Json {
  if (text) return input;
  try {
    return JSON.parse(input) as Json;
  } catch {
    return input;
  }
}

function JsonText({
  value,
  rows,
  onChange,
}: {
  value: unknown;
  rows: number;
  onChange(value: Json): void;
}) {
  const { notify } = useEnv();
  const text = JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  return (
    <textarea
      rows={rows}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        try {
          onChange(JSON.parse(draft) as Json);
        } catch {
          notify('This is not valid JSON', true);
        }
      }}
    />
  );
}

function Amount({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: 'tgas' | number;
  value: string;
  onChange(value: string): void;
}) {
  const [parse, show] = unitsOf(unit);
  const shown = () => (/^\d+$/.test(value) ? show(value) : '');
  const [draft, setDraft] = useState(shown);
  useEffect(() => {
    if (parse(draft) !== value) setDraft(shown());
  }, [value]);
  return (
    <label className="field">
      {label}
      <input
        value={draft}
        inputMode="decimal"
        onChange={(e) => {
          setDraft(e.target.value);
          const parsed = parse(e.target.value);
          if (parsed) onChange(parsed);
        }}
      />
    </label>
  );
}

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange(value: string): void;
}) {
  const list = !value || options.includes(value) ? options : [value, ...options];
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">…</option>}
        {list.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MethodInput({
  label,
  value,
  methods,
  onChange,
}: {
  label: string;
  value: string;
  methods: Methods;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <label className="field">
      {label}
      <input
        list={id}
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {Object.entries(methods).map(([name, method]) => (
          <option key={name} value={name}>
            {[method.kind, method.init && 'init', method.payable && 'payable']
              .filter(Boolean)
              .join(' ')}
          </option>
        ))}
      </datalist>
    </label>
  );
}

function Args({
  value,
  params,
  decimals,
  onChange,
}: {
  value: Json;
  params?: Param[];
  decimals?: number;
  onChange(value: Json): void;
}) {
  const t = useT();
  const [extra, setExtra] = useState('');
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  const names = [
    ...new Set([...(params ?? []).map((param) => param.name), ...Object.keys(object ?? {})]),
  ];
  return (
    <div className="args">
      {object &&
        names.map((name) => {
          const param = params?.find((p) => p.name === name);
          const current = object[name];
          const text = param?.text ?? (current === undefined || typeof current === 'string');
          if (name === 'amount' && decimals !== undefined)
            return (
              <Amount
                key={name}
                label={t('amount, tokens')}
                unit={decimals}
                value={typeof current === 'string' ? current : ''}
                onChange={(amount) => onChange({ ...object, amount })}
              />
            );
          return (
            <label key={name} className="field">
              {name}
              {param && <span className="muted"> · {param.type}</span>}
              <input
                value={
                  current === undefined
                    ? ''
                    : typeof current === 'string'
                      ? current
                      : JSON.stringify(current)
                }
                onChange={(e) => onChange({ ...object, [name]: argValue(e.target.value, text) })}
              />
            </label>
          );
        })}
      <details className="raw">
        <summary>{t('Add an argument or edit as JSON')}</summary>
        {object && (
          <div className="code-pick">
            <label className="field">
              {t('New argument')}
              <input value={extra} autoComplete="off" onChange={(e) => setExtra(e.target.value)} />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={!extra.trim() || extra.trim() in object}
              onClick={() => {
                onChange({ ...object, [extra.trim()]: '' });
                setExtra('');
              }}
            >
              {t('Add')}
            </button>
          </div>
        )}
        <JsonText value={value} rows={4} onChange={onChange} />
      </details>
    </div>
  );
}

function CallFields({
  call,
  scope,
  onChange,
}: {
  call: Call;
  scope: Scope;
  onChange(call: Call): void;
}) {
  const t = useT();
  const methods = scope.methodsOf(call.receiver);
  const set = (part: Partial<Call>) => onChange({ ...call, ...part });
  return (
    <>
      <div className="pair">
        <Pick
          label={t('Signer')}
          value={call.signer}
          options={scope.signers}
          onChange={(signer) => set({ signer })}
        />
        <Pick
          label={t('Contract')}
          value={call.receiver}
          options={scope.accounts}
          onChange={(receiver) => set({ receiver })}
        />
      </div>
      <MethodInput
        label={t('Method')}
        value={call.method}
        methods={methods}
        onChange={(method) =>
          set({
            method,
            args: keep(call.args, methods[method]?.params),
            ...(ONE_YOCTO.test(method) && { deposit: '1' }),
          })
        }
      />
      <Args
        value={call.args}
        params={methods[call.method]?.params}
        decimals={call.method.startsWith('ft_') ? scope.decimalsOf(call.receiver) : undefined}
        onChange={(args) => set({ args })}
      />
      <div className="pair">
        <Amount
          label={t('Deposit, NEAR')}
          unit={NEAR}
          value={call.deposit}
          onChange={(deposit) => set({ deposit })}
        />
        <Amount
          label={t('Gas, TGas')}
          unit="tgas"
          value={call.gas}
          onChange={(gas) => set({ gas })}
        />
      </div>
    </>
  );
}

function CodePick({
  source,
  onPick,
  onAbi,
}: {
  source?: Source;
  onPick(source: Source): void;
  onAbi(methods: Methods): void;
}) {
  const { notify } = useEnv(),
    t = useT();
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (work: Promise<Source>) => {
    setBusy(true);
    work.then(onPick, (error) => notify(errorText(error), true)).finally(() => setBusy(false));
  };
  return (
    <div className="code-source">
      <p className="rule-line">
        {source ? (
          <>
            {t(source.label)} <code>{source.code.sha256.slice(0, 16)}…</code>
          </>
        ) : (
          t('No code yet')
        )}
      </p>
      {source && (
        <p className="hint">
          {t('Methods found: {count}', { count: String(Object.keys(source.methods).length) })}
        </p>
      )}
      <div className="code-pick">
        <label className="field">
          {t('Deployed contract')}
          <input
            placeholder="your-contract.near"
            autoComplete="off"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy || !/^[a-z0-9._-]{2,64}$/.test(account.trim())}
          onClick={() => pick(chainCode(account.trim()))}
        >
          {t('Copy its code')}
        </button>
      </div>
      <label className="field">
        {t('or a .wasm build')}
        <input
          type="file"
          accept=".wasm"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(wasmFile(file));
          }}
        />
      </label>
      {source && (
        <label className="field">
          {t('ABI file from cargo near abi, optional: fields for every argument')}
          <input
            type="file"
            accept=".json"
            onChange={(e) => {
              e.target.files?.[0]
                ?.text()
                .then((text) => onAbi(readAbi(text)))
                .catch((error) => notify(errorText(error), true));
            }}
          />
        </label>
      )}
    </div>
  );
}

function StepCard({
  step,
  index,
  first,
  last,
  scope,
  onChange,
  onMove,
  onRemove,
  onCode,
  onAbi,
}: {
  step: Step;
  index: number;
  first: boolean;
  last: boolean;
  scope: Scope;
  onChange(step: Step): void;
  onMove(by: number): void;
  onRemove(): void;
  onCode(source: Source): void;
  onAbi(sha: string, methods: Methods): void;
}) {
  const t = useT();
  const titles = { account: 'Account', deploy: 'Contract', call: 'Setup call', key: 'Key' };
  if (step.op === 'account' && step.role === 'attacker')
    return (
      <div className="account-row">
        <span className="kicker">{index + 1}</span>
        <label className="field">
          {t('Name')}
          <input value={step.id} readOnly />
        </label>
        <label className="field">
          {t('Role')}
          <input value={t('attacker')} readOnly />
        </label>
        <Amount
          label={t('Balance, NEAR')}
          unit={NEAR}
          value={step.near}
          onChange={(near) => onChange({ ...step, near })}
        />
        <span />
      </div>
    );
  if (step.op === 'account')
    return (
      <div className="account-row">
        <span className="kicker">{index + 1}</span>
        <label className="field">
          {t('Name')}
          <input
            value={step.id}
            autoComplete="off"
            onChange={(e) => onChange({ ...step, id: e.target.value.trim().toLowerCase() })}
          />
        </label>
        <Pick
          label={t('Role')}
          value={step.role}
          options={roles}
          onChange={(role) => onChange({ ...step, role: role as Role })}
        />
        <Amount
          label={t('Balance, NEAR')}
          unit={NEAR}
          value={step.near}
          onChange={(near) => onChange({ ...step, near })}
        />
        <button type="button" className="chip" onClick={onRemove} aria-label={t('Remove')}>
          ✕
        </button>
      </div>
    );
  let body: ReactNode;
  if (step.op === 'deploy') {
    const methods = scope.sources[step.code]?.methods ?? {};
    body = (
      <>
        <Pick
          label={t('Deploy to')}
          value={step.id}
          options={scope.signers}
          onChange={(id) => onChange({ ...step, id })}
        />
        <CodePick
          source={scope.sources[step.code]}
          onPick={onCode}
          onAbi={(found) => onAbi(step.code, found)}
        />
        <MethodInput
          label={t('Init method, empty for none')}
          value={step.init?.method ?? ''}
          methods={methods}
          onChange={(method) =>
            onChange({
              ...step,
              init: method
                ? { method, args: keep(step.init?.args ?? {}, methods[method]?.params) }
                : undefined,
            })
          }
        />
        {step.init && (
          <Args
            value={step.init.args}
            params={methods[step.init.method]?.params}
            onChange={(args) => onChange({ ...step, init: { ...step.init!, args } })}
          />
        )}
      </>
    );
  } else if (step.op === 'call') {
    body = (
      <CallFields call={step.call} scope={scope} onChange={(call) => onChange({ ...step, call })} />
    );
  } else {
    const scoped = step.permission === 'full' ? undefined : step.permission;
    body = (
      <>
        <div className="pair">
          <Pick
            label={t('Added to')}
            value={step.id}
            options={scope.signers}
            onChange={(id) => onChange({ ...step, id })}
          />
          <Pick
            label={t('Attacker key')}
            value={step.key}
            options={scope.keys}
            onChange={(key) => onChange({ ...step, key })}
          />
        </div>
        <Pick
          label={t('Access')}
          value={scoped ? 'function call' : 'full'}
          options={['full', 'function call']}
          onChange={(access) =>
            onChange({
              ...step,
              permission:
                access === 'full'
                  ? 'full'
                  : { receiver: scope.contracts[0] ?? step.id, methods: [], allowance: null },
            })
          }
        />
        {scoped && (
          <>
            <Pick
              label={t('Contract')}
              value={scoped.receiver}
              options={scope.accounts}
              onChange={(receiver) => onChange({ ...step, permission: { ...scoped, receiver } })}
            />
            <label className="field">
              {t('Methods, comma separated, empty for any')}
              <input
                value={scoped.methods.join(', ')}
                onChange={(e) =>
                  onChange({
                    ...step,
                    permission: {
                      ...scoped,
                      methods: e.target.value
                        .split(',')
                        .map((method) => method.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
            <p className="hint">{Object.keys(scope.methodsOf(scoped.receiver)).join(', ')}</p>
          </>
        )}
      </>
    );
  }
  return (
    <div className="step">
      <div className="step-head">
        <span className="kicker">
          {index + 1} · {t(titles[step.op])}
        </span>
        <span className="row">
          <button type="button" className="chip" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" className="chip" disabled={last} onClick={() => onMove(1)}>
            ↓
          </button>
          <button type="button" className="chip" onClick={onRemove} aria-label={t('Remove')}>
            ✕
          </button>
        </span>
      </div>
      {body}
    </div>
  );
}

export function Wizard({
  steps,
  at,
  onAt,
  aside,
  problems,
  children,
}: {
  steps: [string, string][];
  at: number;
  onAt(at: number): void;
  aside: ReactNode;
  problems?: (string | undefined)[];
  children: ReactNode;
}) {
  const t = useT();
  const top = useRef<HTMLOListElement>(null);
  const [stuck, setStuck] = useState(false);
  const go = (next: number) => {
    setStuck(false);
    onAt(next);
    if (top.current && top.current.getBoundingClientRect().top < 0)
      top.current.scrollIntoView({ block: 'start' });
  };
  const blocked = stuck ? problems?.[at] : undefined;
  const mark = (i: number) =>
    i >= at || !problems ? (
      i < at ? (
        '✓'
      ) : (
        i + 1
      )
    ) : problems[i] ? (
      <Icon name="close" size={14} />
    ) : (
      <Icon name="check" size={14} />
    );
  const previous = steps[at - 1];
  const next = steps[at + 1];
  return (
    <>
      <ol ref={top} className="wizard-steps" style={{ '--n': steps.length } as CSSProperties}>
        {steps.map(([title, hint], i) => (
          <li key={title}>
            <button
              type="button"
              className={
                (i < at ? 'done' : i === at ? 'now' : '') +
                (i < at && problems ? (problems[i] ? ' bad' : ' good') : '')
              }
              onClick={() => go(i)}
            >
              <b>
                {mark(i)} {t(title)}
              </b>
              <span>{t(hint)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="wizard">
        <div className="wizard-main">
          {children}
          <div className="wizard-foot">
            {previous ? (
              <button type="button" className="button secondary" onClick={() => go(at - 1)}>
                ← {t(previous[0])}
              </button>
            ) : (
              <span />
            )}
            {next && (
              <button
                type="button"
                className="button"
                onClick={() => (problems?.[at] ? setStuck(true) : go(at + 1))}
              >
                {t('Next')}: {t(next[0]).toLowerCase()} →
              </button>
            )}
          </div>
          {blocked && <p className="error-text">{t(blocked)}</p>}
        </div>
        <aside className="summary" aria-label={t('Your program')}>
          <div className="summary-head">
            <span>{t('YOUR PROGRAM')}</span>
            <span>
              {at + 1}/{steps.length}
            </span>
          </div>
          {aside}
        </aside>
      </div>
    </>
  );
}

export function Summary({
  title,
  ok,
  children,
}: {
  title?: string;
  ok?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className="summary-block">
      {title && (
        <div className={'kicker' + (ok === undefined ? '' : ok ? ' good' : ' bad')}>
          {ok !== undefined && <Icon name={ok ? 'check' : 'close'} size={14} />} {t(title)}
        </div>
      )}
      {children}
    </div>
  );
}

export function WorldLaunch() {
  const t = useT();
  const first = targets[0]!;
  const [start, setStart] = useState({
    target: first.id,
    variant: Object.keys(first.variants).at(-1)!,
  });
  const [program, setProgram] = useState<Program>(
    () => structuredClone(first.variants[start.variant]) as unknown as Program,
  );
  const [sources, setSources] = useState(() => sourcesOf(program.codes, first.methods));
  const [fetched, setFetched] = useState<Record<string, number>>({});
  const [reward, setReward] = useState(nearOf(5));
  const [hashed, setHashed] = useState({ text: '', hash: '' });
  const [round, setRound] = useState(0);
  const [at, setAt] = useState(0);
  const target = targets.find((x) => x.id === start.target);

  const open = (id: string, variant?: string) => {
    const next = targets.find((x) => x.id === id);
    const name = next && (variant ?? Object.keys(next.variants).at(-1)!);
    const spec = next ? (structuredClone(next.variants[name!]) as unknown as Program) : blank();
    setStart({ target: next?.id ?? '', variant: name ?? '' });
    setProgram(spec);
    setSources(sourcesOf(spec.codes, next?.methods));
    setRound((n) => n + 1);
  };

  const roleOf = new Map(
    program.steps.flatMap((s) => (s.op === 'account' ? [[s.id, s.role] as const] : [])),
  );
  const codeOf = new Map(
    program.steps.flatMap((s) => (s.op === 'deploy' ? [[s.id, s.code] as const] : [])),
  );
  const scope: Scope = {
    accounts: [...roleOf.keys()],
    signers: [...roleOf.keys()].filter((id) => roleOf.get(id) !== 'attacker'),
    contracts: [...codeOf.keys()],
    keys: Array.from({ length: program.attackerKeys }, (_, i) => `key:${i}`),
    sources,
    methodsOf: (account) =>
      Object.fromEntries(
        Object.entries(sources[codeOf.get(account) ?? '']?.methods ?? {}).map(([name, method]) => [
          name,
          method.params || !standard[name] ? method : { ...method, params: standard[name] },
        ]),
      ),
    decimalsOf: (account) => {
      const deploy = program.steps.find((s) => s.op === 'deploy' && s.id === account);
      if (deploy?.op !== 'deploy') return NEAR;
      const own = (deploy.init?.args as { metadata?: { decimals?: unknown } } | undefined)?.metadata
        ?.decimals;
      return typeof own === 'number' ? own : (fetched[deploy.code] ?? NEAR);
    },
  };
  const used = new Set(codeOf.values());
  const spec: Program = {
    ...program,
    codes: Object.values(sources)
      .map((source) => source.code)
      .filter((code) => used.has(code.sha256)),
  };
  const text = JSON.stringify(spec, null, 2);
  const problems = check(spec, sources);
  const name = (spec.title || 'program').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const files = Object.values(sources).filter((s) => s.file && used.has(s.code.sha256));
  const attack = target
    ? target.cases[0]!.attack
    : {
        accounts: {},
        txs: [
          {
            signerAccount: 'attacker',
            signingKey: 'key:0',
            receiver: scope.contracts[0] ?? '',
            actions: [
              {
                type: 'FunctionCall',
                method: Object.keys(scope.methodsOf(scope.contracts[0] ?? ''))[0] ?? '',
                args: {},
                deposit: '0',
                gas: gasOf(30),
              },
            ],
          },
        ],
      };
  const setup = [
    '# ' + t('once: the CLI and a local NEAR chain (Node 22+)'),
    `git clone ${repository} && cd sealed-bounty && npm ci`,
    `curl -L ${sandbox} | tar -xz`,
    'export NEAR_SANDBOX_BIN=$PWD/near-sandbox',
    '# ' + t('test run: a fresh chain, your code, one attack, a verdict'),
    ...files.map((s) => `cp path/to/${s.file} fixtures/wasm/${s.code.sha256}.wasm`),
    `npm run cli -- world-run ~/Downloads/${name}.program.json ~/Downloads/${name}.attack.json`,
  ].join('\n');

  useEffect(() => {
    let current = true;
    programDigest(spec as unknown as Spec).then(
      (hash) => current && setHashed({ text, hash }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [text]);

  useEffect(() => {
    for (const { code, methods } of Object.values(sources))
      if ('ft_metadata' in methods && !(code.sha256 in fetched))
        ftDecimals(code).then(
          (decimals) =>
            decimals !== undefined && setFetched((all) => ({ ...all, [code.sha256]: decimals })),
          () => undefined,
        );
  }, [sources]);

  const steps = (change: (steps: Step[]) => Step[]) =>
    setProgram((p) => ({ ...p, steps: change(p.steps) }));
  const rules = (change: (rules: Rule[]) => Rule[]) =>
    setProgram((p) => ({ ...p, rules: change(p.rules) }));
  const has = (id: Rule['id']) => program.rules.some((rule) => rule.id === id);
  const threshold =
    program.rules.flatMap((rule) => (rule.id === 'block' ? [] : [rule.threshold]))[0] ?? FLOOR;
  const block = program.rules.find((rule): rule is Block => rule.id === 'block');
  const victim = scope.signers.find((id) => !codeOf.has(id)) ?? scope.signers[0] ?? '';
  const toggle = (id: Rule['id']) =>
    rules((all) =>
      all.some((rule) => rule.id === id)
        ? all.filter((rule) => rule.id !== id)
        : [
            ...all,
            id === 'block'
              ? {
                  id,
                  victim: {
                    signer: victim,
                    receiver: scope.contracts[0] ?? '',
                    method: '',
                    args: {},
                    deposit: '0',
                    gas: gasOf(100),
                  },
                  claim: { contract: scope.contracts[0] ?? '', method: '', args: {} },
                  expect: { account: victim, token: 'NEAR', amount: '0' },
                }
              : { id, threshold },
          ],
    );
  const setBlock = (next: Block) =>
    rules((all) => all.map((rule) => (rule.id === 'block' ? next : rule)));
  const rank = { account: 0, deploy: 1, key: 2, call: 3 };
  const add = (...fresh: Step[]) =>
    steps((all) =>
      fresh.reduce((list, step) => {
        const after = list.reduce((last, s, i) => (rank[s.op] <= rank[step.op] ? i : last), -1);
        return [...list.slice(0, after + 1), step, ...list.slice(after + 1)];
      }, all),
    );
  const contract = `contract${scope.contracts.length + 1}.test.near`;
  const registry = scope.contracts.filter((id) => 'storage_deposit' in scope.methodsOf(id));
  const registration = (token: string, account: string) =>
    program.steps.findIndex(
      (s) =>
        s.op === 'call' &&
        s.call.receiver === token &&
        s.call.method === 'storage_deposit' &&
        (s.call.args as { account_id?: Json } | null)?.account_id === account,
    );
  const register = (token: string, account: string) => {
    const index = registration(token, account);
    const call: Step = {
      op: 'call',
      call: {
        signer: roleOf.get(account) === 'attacker' ? victim : account,
        receiver: token,
        method: 'storage_deposit',
        args: { account_id: account },
        deposit: STORAGE,
        gas: gasOf(30),
      },
    };
    steps((all) => {
      if (index >= 0) return all.filter((_, i) => i !== index);
      const at = all.findIndex((s) => s.op === 'call');
      return at < 0 ? [...all, call] : [...all.slice(0, at), call, ...all.slice(at)];
    });
  };
  const decimals = (token: string) => 10n ** BigInt(scope.decimalsOf(token));
  const list = (op: Step['op']) => {
    const shown = program.steps.flatMap((step, index) => (step.op === op ? [index] : []));
    return shown.map((index, pos) => (
      <StepCard
        key={`${round}-${index}`}
        step={program.steps[index]!}
        index={index}
        first={pos === 0}
        last={pos === shown.length - 1}
        scope={scope}
        onChange={(next) => steps((all) => all.map((s, i) => (i === index ? next : s)))}
        onMove={(by) =>
          steps((all) => {
            const next = [...all];
            const other = shown[pos + by]!;
            [next[index], next[other]] = [next[other]!, next[index]!];
            return next;
          })
        }
        onRemove={() => steps((all) => all.filter((_, i) => i !== index))}
        onCode={(source) => {
          setSources((all) => ({ ...all, [source.code.sha256]: source }));
          steps((all) =>
            all.map((s, i) =>
              i === index && s.op === 'deploy' ? { ...s, code: source.code.sha256 } : s,
            ),
          );
        }}
        onAbi={(sha, methods) =>
          setSources((all) => ({
            ...all,
            [sha]: { ...all[sha]!, methods: { ...all[sha]!.methods, ...methods } },
          }))
        }
      />
    ));
  };
  const chip = (current: boolean, label: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      className={'chip' + (current ? ' current' : '')}
      onClick={onClick}
    >
      {t(label)}
    </button>
  );
  const ruleNames = { take: 'theft', loss: 'any loss', block: 'withdrawal blocked' };

  const screens = [
    <>
      <section className="card">
        <div className="kicker">{t('FILL FROM')}</div>
        <div className="samples">
          {targets.map((x) => chip(x.id === start.target, x.title, () => open(x.id)))}
          {chip(!start.target, 'Empty form', () => open(''))}
        </div>
        {target && Object.keys(target.variants).length > 1 && (
          <div className="samples">
            {Object.keys(target.variants).map((v) =>
              chip(v === start.variant, v, () => open(target.id, v)),
            )}
          </div>
        )}
        <label className="field">
          {t('Program name')}
          <input
            value={program.title}
            onChange={(e) => setProgram((p) => ({ ...p, title: e.target.value }))}
          />
        </label>
      </section>
      <div className="step-list">{list('deploy')}</div>
      <div className="row">
        {chip(false, '+ Add a contract', () =>
          add(
            { op: 'account', id: contract, near: nearOf(10), role: 'protected' },
            { op: 'deploy', id: contract, code: '' },
          ),
        )}
      </div>
      <p className="hint">
        {t(
          'Attacks hit a local copy, never your live contract. Methods come from the contract code; upload its ABI to get a field per argument.',
        )}
      </p>
    </>,
    <>
      <section className="card">
        <div className="kicker">{t('ACCOUNTS IN THE TEST CHAIN')}</div>
        <div className="account-row account-head">
          <span />
          <span>{t('account')}</span>
          <span>{t('role')}</span>
          <span>NEAR</span>
          <span />
        </div>
        <div className="account-list">{list('account')}</div>
        <div className="row">
          {chip(false, '+ Add account', () =>
            add({
              op: 'account',
              id: `user${scope.accounts.length + 1}.test.near`,
              near: nearOf(10),
              role: 'protected',
            }),
          )}
        </div>
        <p className="hint">
          {t(
            'Protected: its loss is a break. Neutral: just there. The attacker is a stand-in: any hunter plays it here, with its sub-accounts and keys. Only its starting balance matters; the reward goes to the wallet that sends the attack.',
          )}
        </p>
      </section>
      {registry.length > 0 && (
        <section className="card">
          <div className="kicker">{t('REGISTERED IN TOKENS')}</div>
          {registry.map((token) => (
            <div key={token} className="field">
              {token}
              <div className="samples">
                {scope.accounts
                  .filter((id) => id !== token)
                  .map((id) => chip(registration(token, id) >= 0, id, () => register(token, id)))}
              </div>
            </div>
          ))}
          <p className="hint">
            {t(
              'An account holds a token only after it registers. Each mark adds a storage_deposit call.',
            )}
          </p>
        </section>
      )}
      <section className="card">
        <div className="kicker">{t('SETUP CALLS')}</div>
        <div className="step-list">{list('call')}</div>
        <div className="row">
          {chip(false, '+ Add call', () =>
            add({
              op: 'call',
              call: {
                signer: victim,
                receiver: scope.contracts[0] ?? '',
                method: '',
                args: {},
                deposit: '0',
                gas: gasOf(30),
              },
            }),
          )}
        </div>
        <p className="hint">{t('Runs before every attack, in this order.')}</p>
      </section>
      <section className="card">
        <div className="kicker">{t('KEYS GIVEN TO THE ATTACKER')}</div>
        <label className="field">
          {t('Attacker keys')}
          <input
            value={program.attackerKeys}
            inputMode="numeric"
            onChange={(e) =>
              /^[1-4]$/.test(e.target.value) &&
              setProgram((p) => ({ ...p, attackerKeys: Number(e.target.value) }))
            }
          />
        </label>
        <div className="step-list">{list('key')}</div>
        <div className="row">
          {chip(false, '+ Give a key', () =>
            add({ op: 'key', id: scope.contracts[0] ?? victim, key: 'key:0', permission: 'full' }),
          )}
        </div>
        <p className="hint">{t('The hunter signs the attack with these keys.')}</p>
      </section>
    </>,
    <>
      <section className="card">
        <div className="kicker">{t('A BREAK IS')}</div>
        <label className="check">
          <input type="checkbox" checked={has('take')} onChange={() => toggle('take')} />
          {t('attacker gains what a protected account loses')}
        </label>
        <label className="check">
          <input type="checkbox" checked={has('loss')} onChange={() => toggle('loss')} />
          {t('a protected account loses value')}
        </label>
        <label className="check">
          <input type="checkbox" checked={!!block} onChange={() => toggle('block')} />
          {t('a protected withdrawal stops working')}
        </label>
        <Amount
          label={t('Ignore moves smaller than (NEAR)')}
          unit={NEAR}
          value={threshold}
          onChange={(value) =>
            rules((all) =>
              all.map((rule) => (rule.id === 'block' ? rule : { ...rule, threshold: value })),
            )
          }
        />
        {block && (
          <div className="args">
            <p className="hint">
              {t(
                'After the attack a protected account makes this call and must still receive what the view says it is owed.',
              )}
            </p>
            <CallFields
              call={block.victim}
              scope={scope}
              onChange={(victim) => setBlock({ ...block, victim })}
            />
            <Pick
              label={t('Owed amount from')}
              value={block.claim.contract}
              options={scope.contracts}
              onChange={(contract) => setBlock({ ...block, claim: { ...block.claim, contract } })}
            />
            <MethodInput
              label={t('View method')}
              value={block.claim.method}
              methods={scope.methodsOf(block.claim.contract)}
              onChange={(method) => setBlock({ ...block, claim: { ...block.claim, method } })}
            />
            <Args
              value={block.claim.args}
              params={scope.methodsOf(block.claim.contract)[block.claim.method]?.params}
              onChange={(args) => setBlock({ ...block, claim: { ...block.claim, args } })}
            />
            <div className="pair">
              <Pick
                label={t('Receiver')}
                value={block.expect.account}
                options={scope.signers}
                onChange={(account) => setBlock({ ...block, expect: { ...block.expect, account } })}
              />
              <Pick
                label={t('Paid in')}
                value={block.expect.token}
                options={['NEAR', ...scope.contracts]}
                onChange={(token) => setBlock({ ...block, expect: { ...block.expect, token } })}
              />
            </div>
            <Amount
              label={t('It pays without an attack, {token}', { token: block.expect.token })}
              unit={block.expect.token === 'NEAR' ? NEAR : scope.decimalsOf(block.expect.token)}
              value={block.expect.amount}
              onChange={(amount) => setBlock({ ...block, expect: { ...block.expect, amount } })}
            />
          </div>
        )}
      </section>
      <section className="card">
        <div className="kicker">{t('TOKENS COUNTED AS VALUE')}</div>
        {program.tokens.map((token, i) => (
          <div key={i} className="pair">
            <Pick
              label={t('Token contract')}
              value={token.contract}
              options={scope.contracts}
              onChange={(contract) =>
                setProgram((p) => ({
                  ...p,
                  tokens: p.tokens.map((x, j) => (j === i ? { ...x, contract } : x)),
                }))
              }
            />
            <Amount
              label={t('1 token = … NEAR')}
              unit={NEAR}
              value={(BigInt(token.rate || '0') * decimals(token.contract)).toString()}
              onChange={(value) =>
                setProgram((p) => ({
                  ...p,
                  tokens: p.tokens.map((x, j) =>
                    j === i ? { ...x, rate: (BigInt(value) / decimals(x.contract)).toString() } : x,
                  ),
                }))
              }
            />
          </div>
        ))}
        <div className="row">
          {chip(false, '+ token', () =>
            setProgram((p) => ({
              ...p,
              tokens: [
                ...p.tokens,
                {
                  contract: scope.contracts[0] ?? '',
                  rate: (YOCTO / decimals(scope.contracts[0] ?? '')).toString(),
                },
              ],
            })),
          )}
          {program.tokens.length > 0 &&
            chip(false, 'Remove the last token', () =>
              setProgram((p) => ({ ...p, tokens: p.tokens.slice(0, -1) })),
            )}
        </div>
        <p className="hint">
          {t('NEAR always counts. The verifier compares balances before and after the attack.')}
        </p>
      </section>
      <section className="card">
        <Amount label={t('Reward (NEAR)')} unit={NEAR} value={reward} onChange={setReward} />
        <details className="raw">
          <summary>{t('Advanced: limits for one attack')}</summary>
          <div className="pair">
            {limitFields.map(([key, label, gas]) =>
              gas ? (
                <Amount
                  key={key}
                  label={t(label)}
                  unit="tgas"
                  value={String(program.limits[key])}
                  onChange={(value) =>
                    setProgram((p) => ({ ...p, limits: { ...p.limits, [key]: value } }))
                  }
                />
              ) : (
                <label key={key} className="field">
                  {t(label)}
                  <input
                    value={program.limits[key]}
                    inputMode="numeric"
                    onChange={(e) =>
                      /^\d{1,7}$/.test(e.target.value) &&
                      setProgram((p) => ({
                        ...p,
                        limits: { ...p.limits, [key]: Number(e.target.value) },
                      }))
                    }
                  />
                </label>
              ),
            )}
          </div>
        </details>
      </section>
    </>,
    <section className="card">
      {problems.length ? (
        <ul className="problems">
          {problems.map(([problem, vars], i) => (
            <li key={i}>{t(problem, vars)}</li>
          ))}
        </ul>
      ) : (
        <p>
          {t('Program hash')}: <code>{hashed.text === text ? hashed.hash : '…'}</code>
        </p>
      )}
      <p className="hint">
        {t(
          'Hunters see this hash on the bounty. Any change to code, balances or rules changes it.',
        )}
      </p>
      <details className="raw">
        <summary>program.json</summary>
        <JsonText
          value={spec}
          rows={18}
          onChange={(value) => {
            const next = value as unknown as Program;
            if (!Array.isArray(next?.steps) || !Array.isArray(next.codes)) return;
            setProgram(next);
            setSources((all) => ({ ...sourcesOf(next.codes), ...all }));
          }}
        />
      </details>
      <button type="button" className="button off" disabled>
        {t('Fund and publish · {amount} NEAR', { amount: toNear(reward) })}
      </button>
      <p className="hint">
        {t(
          'The reward goes to escrow. Every attack replays in the TEE on a fresh chain with your code, and the contract pays the first proved break.',
        )}
      </p>
      <div className="instead">
        <div className="kicker">{t('ON TESTNET, INSTEAD')}</div>
        <p>
          {t(
            'Contract replays do not run in the TEE on testnet yet. The verifier operator publishes your program:',
          )}
        </p>
        <ol>
          <li>
            {t('Download the program and a sample attack.')}
            <div className="row">
              <button
                type="button"
                className="button secondary"
                disabled={problems.length > 0}
                onClick={() => download(`${name}.program.json`, text)}
              >
                {t('Download program.json')}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => download(`${name}.attack.json`, JSON.stringify(attack, null, 2))}
              >
                {t('Download a sample attack')}
              </button>
            </div>
          </li>
          <li>
            {t('Replay the attack on your machine.')}
            <pre>{setup}</pre>
            <p className="hint">
              {t(
                'On Linux replace Darwin-arm64 with Linux-x86_64. The sample is a known attack from the results list; write your own in the same format.',
              )}
            </p>
          </li>
          <li>
            {t(
              'Send program.json to the verifier operator. They fund the escrow with your reward:',
            )}
            <pre>{`BOUNTY_REWARD_YOCTO=${reward} npm run cli -- program-create ${name}.program.json`}</pre>
          </li>
        </ol>
      </div>
    </section>,
  ];

  const keys = program.steps.flatMap((s) => (s.op === 'key' ? [s] : []));
  const calls = program.steps.flatMap((s) => (s.op === 'call' ? [s.call] : []));
  const aside = (
    <>
      <Summary title="CODE">
        {program.steps.flatMap((s) =>
          s.op === 'deploy'
            ? [
                <p key={s.id}>
                  {s.id}
                  <br />
                  <span className="hint">{sources[s.code]?.label ?? t('code not chosen')}</span>
                </p>,
              ]
            : [],
        )}
      </Summary>
      <Summary title="WHO HOLDS WHAT">
        {program.steps.flatMap((s) =>
          s.op === 'account'
            ? [
                <div key={s.id} className="holder">
                  <span>{s.id}</span>
                  <span className={'tag ' + s.role}>{t(s.role)}</span>
                  <strong>{/^\d+$/.test(s.near) ? toNear(s.near) : '…'}</strong>
                </div>,
              ]
            : [],
        )}
        {keys.map((k, i) => (
          <p key={i} className="hint">
            {t('attacker key on {id}', { id: k.id })}:{' '}
            {k.permission === 'full'
              ? t('full access')
              : t('only {methods}', { methods: k.permission.methods.join(', ') || '*' })}
          </p>
        ))}
      </Summary>
      <Summary title="SETUP">
        {calls.length ? (
          calls.map((c, i) => (
            <p key={i}>
              {c.signer} → {c.method || '…'}()
              {/^\d+$/.test(c.deposit) && c.deposit !== '0' ? ` · ${toNear(c.deposit)} NEAR` : ''}
            </p>
          ))
        ) : (
          <p className="hint">{t('No setup calls')}</p>
        )}
      </Summary>
      <Summary title="RULE">
        <p>
          {program.rules.map((rule) => t(ruleNames[rule.id])).join(', ') || '…'} ·{' '}
          {t('ignore < {amount} NEAR', { amount: toNear(threshold) })}
        </p>
      </Summary>
      <Summary>
        <dl className="kv">
          <dt>{t('reward')}</dt>
          <dd>{toNear(reward)} NEAR</dd>
          <dt>{t('rules hash')}</dt>
          <dd>
            <code>
              {hashed.text === text && hashed.hash
                ? `${hashed.hash.slice(0, 8)}…${hashed.hash.slice(-4)}`
                : '…'}
            </code>
          </dd>
        </dl>
        <p className="hint">
          {problems[0]
            ? t('Still needed: {what}', { what: t(...problems[0]) })
            : t('Ready to publish.')}
        </p>
      </Summary>
    </>
  );

  return (
    <Wizard
      steps={[
        ['Code', 'what gets attacked'],
        ['Who holds what', 'accounts, setup, keys'],
        ['Rule & reward', 'what counts as a break'],
        ['Publish', 'fund the escrow'],
      ]}
      at={at}
      onAt={setAt}
      aside={aside}
    >
      {screens[at]}
    </Wizard>
  );
}
