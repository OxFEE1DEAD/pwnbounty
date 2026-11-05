import { useEffect, useId, useState, type ReactNode } from 'react';
import { readLimited } from './chain.js';
import { digest } from './crypto.js';
import { errorText, useEnv } from './env.js';
import { useT } from './i18n.js';
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
}

const YOCTO = 10n ** 24n;
const TGAS = 10n ** 12n;
const ACCOUNT = /^[a-z0-9]+(?:[-_][a-z0-9]+)*\.test\.near$/;
const FLOOR = '100000000000000000000000';
const roles: Role[] = ['protected', 'neutral', 'attacker'];
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
const toYocto = (value: string) => {
  const match = /^(\d{1,12})(?:\.(\d{1,24}))?$/.exec(value.trim());
  if (!match) return undefined;
  return (BigInt(match[1]!) * YOCTO + BigInt((match[2] ?? '').padEnd(24, '0'))).toString();
};
const toNear = (value: string) => {
  const amount = BigInt(value);
  const fraction = (amount % YOCTO).toString().padStart(24, '0').replace(/0+$/, '');
  return `${amount / YOCTO}${fraction ? '.' + fraction : ''}`;
};
const toGas = (value: string) =>
  /^\d{1,4}$/.test(value.trim()) ? (BigInt(value.trim()) * TGAS).toString() : undefined;
const units = {
  near: [toYocto, toNear],
  tgas: [toGas, (value: string) => (BigInt(value) / TGAS).toString()],
} as const;

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

async function chainCode(account: string): Promise<Source> {
  const network = account.endsWith('.testnet') ? 'testnet' : 'mainnet';
  const response = await fetch(rpcs[network], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'code',
      method: 'query',
      params: { request_type: 'view_code', finality: 'final', account_id: account },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = JSON.parse(new TextDecoder().decode(await readLimited(response, 8_388_608)));
  const result = body?.result as { code_base64?: string; block_height?: number } | undefined;
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
  unit: keyof typeof units;
  value: string;
  onChange(value: string): void;
}) {
  const [parse, show] = units[unit];
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
  onChange,
}: {
  value: Json;
  params?: Param[];
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
        onChange={(method) => set({ method, args: keep(call.args, methods[method]?.params) })}
      />
      <Args
        value={call.args}
        params={methods[call.method]?.params}
        onChange={(args) => set({ args })}
      />
      <div className="pair">
        <Amount
          label={t('Deposit, NEAR')}
          unit="near"
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
  let body: ReactNode;
  if (step.op === 'account') {
    body = (
      <>
        <label className="field">
          {t('Name')}
          <input
            value={step.id}
            autoComplete="off"
            onChange={(e) => onChange({ ...step, id: e.target.value.trim().toLowerCase() })}
          />
        </label>
        <div className="pair">
          <Pick
            label={t('Role')}
            value={step.role}
            options={roles}
            onChange={(role) => onChange({ ...step, role: role as Role })}
          />
          <Amount
            label={t('Balance, NEAR')}
            unit="near"
            value={step.near}
            onChange={(near) => onChange({ ...step, near })}
          />
        </div>
      </>
    );
  } else if (step.op === 'deploy') {
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
          <button type="button" className="chip" disabled={index === 0} onClick={() => onMove(-1)}>
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

export function WorldLaunch({ switcher }: { switcher: ReactNode }) {
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
  const [reward, setReward] = useState(nearOf(5));
  const [hashed, setHashed] = useState({ text: '', hash: '' });
  const [round, setRound] = useState(0);
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
    methodsOf: (account) => sources[codeOf.get(account) ?? '']?.methods ?? {},
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
  const added: [string, () => Step][] = [
    [
      '+ account',
      () => ({
        op: 'account',
        id: `user${scope.accounts.length + 1}.test.near`,
        near: nearOf(10),
        role: 'protected',
      }),
    ],
    ['+ contract', () => ({ op: 'deploy', id: victim, code: '' })],
    [
      '+ setup call',
      () => ({
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
    ],
    [
      '+ key',
      () => ({ op: 'key', id: scope.contracts[0] ?? victim, key: 'key:0', permission: 'full' }),
    ],
  ];

  return (
    <div className="wrap">
      <div className="hunt-head">
        <div className="eyebrow">{t('FOR PROJECTS')}</div>
        <h1>{t('Put your project under a sealed bounty')}</h1>
        <p className="lead">
          {t(
            'Describe the code, who holds what, and what counts as a break. Hunters attack a fresh copy; the reward leaves escrow only for a proved break.',
          )}
        </p>
        {switcher}
      </div>
      <div className="launch">
        <section className="card">
          <div className="kicker">1 · {t('START')}</div>
          <div className="samples">
            <button
              type="button"
              className={'chip' + (start.target ? '' : ' current')}
              onClick={() => open('')}
            >
              {t('From scratch')}
            </button>
            {targets.map((x) => (
              <button
                key={x.id}
                type="button"
                className={'chip' + (x.id === start.target ? ' current' : '')}
                onClick={() => open(x.id)}
              >
                {t(x.title)}
              </button>
            ))}
          </div>
          {target && Object.keys(target.variants).length > 1 && (
            <div className="samples">
              {Object.keys(target.variants).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={'chip' + (v === start.variant ? ' current' : '')}
                  onClick={() => open(target.id, v)}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          )}
          <p className="hint">
            {t(
              'A template fills the same form. Change anything: code, accounts, setup calls, rules.',
            )}
          </p>
          <label className="field">
            {t('Program name')}
            <input
              value={program.title}
              onChange={(e) => setProgram((p) => ({ ...p, title: e.target.value }))}
            />
          </label>
          <div className="pair">
            <Amount label={t('Reward (NEAR)')} unit="near" value={reward} onChange={setReward} />
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
          </div>
        </section>
        <section className="card">
          <div className="kicker">2 · {t('WHAT COUNTS AS A BREAK')}</div>
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
            unit="near"
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
                  onChange={(account) =>
                    setBlock({ ...block, expect: { ...block.expect, account } })
                  }
                />
                <Pick
                  label={t('Paid in')}
                  value={block.expect.token}
                  options={['NEAR', ...scope.contracts]}
                  onChange={(token) => setBlock({ ...block, expect: { ...block.expect, token } })}
                />
              </div>
              <Amount
                label={t('It pays without an attack, NEAR or token units with 24 decimals')}
                unit="near"
                value={block.expect.amount}
                onChange={(amount) => setBlock({ ...block, expect: { ...block.expect, amount } })}
              />
            </div>
          )}
          <h3>{t('Tokens counted as value')}</h3>
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
              <label className="field">
                {t('yoctoNEAR per token unit')}
                <input
                  value={token.rate}
                  inputMode="numeric"
                  onChange={(e) =>
                    /^\d{0,39}$/.test(e.target.value) &&
                    setProgram((p) => ({
                      ...p,
                      tokens: p.tokens.map((x, j) =>
                        j === i ? { ...x, rate: e.target.value } : x,
                      ),
                    }))
                  }
                />
              </label>
            </div>
          ))}
          <div className="row">
            <button
              type="button"
              className="chip"
              onClick={() =>
                setProgram((p) => ({
                  ...p,
                  tokens: [...p.tokens, { contract: scope.contracts[0] ?? '', rate: '1' }],
                }))
              }
            >
              {t('+ token')}
            </button>
            {program.tokens.length > 0 && (
              <button
                type="button"
                className="chip"
                onClick={() => setProgram((p) => ({ ...p, tokens: p.tokens.slice(0, -1) }))}
              >
                {t('Remove the last token')}
              </button>
            )}
          </div>
        </section>
        <section className="card wide">
          <div className="kicker">3 · {t('SETUP, STEP BY STEP')}</div>
          <p className="hint">
            {t(
              'Every attack runs on a fresh local NEAR chain built by these steps. Your live contract is never touched. Methods come from the contract code; upload its ABI to get a field per argument.',
            )}
          </p>
          <div className="step-list">
            {program.steps.map((step, index) => (
              <StepCard
                key={`${round}-${index}`}
                step={step}
                index={index}
                last={index === program.steps.length - 1}
                scope={scope}
                onChange={(next) => steps((all) => all.map((s, i) => (i === index ? next : s)))}
                onMove={(by) =>
                  steps((all) => {
                    const next = [...all];
                    next.splice(index + by, 0, next.splice(index, 1)[0]!);
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
            ))}
          </div>
          <div className="row">
            {added.map(([label, make]) => (
              <button
                key={label}
                type="button"
                className="chip"
                onClick={() => steps((all) => [...all, make()])}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </section>
        <section className="card review">
          <div className="kicker">4 · {t('REVIEW AND EXPORT')}</div>
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
            <summary>{t('Limits for one attack')}</summary>
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
          <div className="row">
            <button
              type="button"
              className="button"
              disabled={problems.length > 0}
              onClick={() => download(`${name}.program.json`, text)}
            >
              {t('Download program.json')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => download(`${name}.attack.json`, JSON.stringify(attack, null, 2))}
            >
              {t('Download a sample attack')}
            </button>
          </div>
          <h3>{t('Test run on your machine')}</h3>
          <pre>{setup}</pre>
          <p className="hint">
            {t(
              'On Linux replace Darwin-arm64 with Linux-x86_64. The sample is a known attack from the results list; write your own in the same format.',
            )}
          </p>
          <h3>{t('Publish')}</h3>
          <p>
            {t(
              'Publishing needs the verifier keys, so in test mode the verifier operator runs it with your files. The reward goes to escrow and the program appears in the hacker catalog. Publishing with your wallet from this page is not available yet.',
            )}
          </p>
          <pre>{`BOUNTY_REWARD_YOCTO=${reward} npm run cli -- program-create ${name}.program.json`}</pre>
        </section>
      </div>
    </div>
  );
}
