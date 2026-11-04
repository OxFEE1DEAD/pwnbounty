import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { readLimited } from './chain.js';
import { canonical, digest } from './crypto.js';
import { errorText, useEnv } from './env.js';
import { useT } from './i18n.js';
import { repository } from './landing.js';
import data from './checks.json';

type Outcome =
  'violation' | 'no_violation' | 'limit' | 'invalid_attack' | 'inconclusive' | 'infra_error';
type Delta = { account: string; token: string; amount: string };
type Result = { expected: Outcome; outcome: Outcome; rule?: string; deltas?: Delta[]; ms: number };
export type Spec = {
  title: string;
  steps: { op: string; id?: string; near?: string; role?: string; code?: string }[];
  codes: { source: string; sha256: string; network?: string; account?: string; block?: string }[];
  rules: { id: string; threshold?: string }[];
  [key: string]: unknown;
};
type Target = {
  id: string;
  title: string;
  concept: string;
  source: string;
  variants: Record<string, Spec>;
  hashes: Record<string, string>;
  cases: { id: string; title: string; attack: unknown; results: Record<string, Result> }[];
};
type AgentRow = { id: string; kind: string; config: string; expected: string; violation: boolean };

const coverage = data as unknown as {
  engine: { judge: string; sandbox: string };
  measured: string;
  platform: string;
  agent: { variants: string[]; cases: AgentRow[] };
  targets: Target[];
};

const concepts: Record<string, string> = {
  contract: 'Contract with deposits',
  token: 'Fungible token',
  intents: 'Intents protocol',
  agent: 'Agent wallet',
};
const outcomes: Record<Outcome, string> = {
  violation: 'Break proved - reward',
  no_violation: 'No break - zero',
  invalid_attack: 'Not a valid attack',
  limit: 'Over the limits',
  inconclusive: 'Could not decide',
  infra_error: 'Infrastructure error',
};
const ruleNames: Record<string, string> = {
  take: 'attacker gains what a protected account loses',
  loss: 'a protected account loses value',
  block: 'a protected withdrawal stops working',
};
const YOCTO = 10n ** 24n;
const abs = (value: bigint) => (value < 0n ? -value : value);

export const near = (yocto: string | bigint) => {
  const value = BigInt(yocto);
  const sign = value < 0n ? '−' : value > 0n ? '+' : '';
  const fraction = (abs(value) % YOCTO).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return `${sign}${abs(value) / YOCTO}${fraction ? '.' + fraction : ''}`;
};

export const programDigest = (spec: Spec) => digest(canonical({ spec, engine: coverage.engine }));

export function attackSamples(hash: string) {
  const target = coverage.targets.find((t) => Object.values(t.hashes).includes(hash));
  return (target?.cases ?? []).map((c) => ({
    label: c.title,
    text: JSON.stringify(c.attack, null, 1),
  }));
}

export function Holders({ spec }: { spec: Spec }) {
  const t = useT();
  return (
    <>
      {spec.steps
        .filter((s) => s.op === 'account')
        .map((a) => (
          <div key={a.id} className="payout-row holder">
            <span>{a.id}</span>
            <span className={'tag ' + a.role}>{t(a.role!)}</span>
            <strong>{near(a.near!).replace('+', '')} NEAR</strong>
          </div>
        ))}
    </>
  );
}

export function RuleList({ spec }: { spec: Spec }) {
  const t = useT();
  return (
    <ul className="rule-list">
      {spec.rules.map((r) => (
        <li key={r.id}>
          <b>{r.id}</b> {t(ruleNames[r.id] ?? r.id)}
        </li>
      ))}
    </ul>
  );
}

const agentMatched = coverage.agent.cases.filter((r) => String(r.violation) === r.expected).length;

function Pill({ result }: { result: Result }) {
  const t = useT();
  const ok = result.outcome === result.expected;
  return (
    <span
      className={`pill ${result.outcome}`}
      title={ok ? '' : t('Expected: {x}', { x: result.expected })}
    >
      {t(outcomes[result.outcome])} {ok ? '✓' : '✗'}
    </span>
  );
}

function Deltas({ result }: { result: Result }) {
  const shown = (result.deltas ?? []).filter((d) => abs(BigInt(d.amount)) > YOCTO / 100n);
  if (!shown.length) return null;
  return (
    <div className="deltas">
      {shown.map((d) => (
        <code key={d.account + d.token}>
          {d.account.replace('.test.near', '')} {near(d.amount)}{' '}
          {d.token === 'NEAR' ? 'NEAR' : 'wNEAR'}
        </code>
      ))}
    </div>
  );
}

function TargetCard({ target }: { target: Target }) {
  const t = useT();
  const variants = Object.keys(target.variants);
  const rules = Object.values(target.variants)[0]!.rules;
  return (
    <article className="card target">
      <div className="kicker">{t(concepts[target.concept] ?? target.concept)}</div>
      <h3>{t(target.title)}</h3>
      <p className="muted">{t(target.source)}</p>
      <ul className="rule-list">
        {rules.map((r) => (
          <li key={r.id}>
            <b>{r.id}</b> {t(ruleNames[r.id] ?? r.id)}
            {r.threshold && ` > ${near(r.threshold).replace('+', '')} NEAR`}
          </li>
        ))}
      </ul>
      <div className="matrix" style={{ '--n': variants.length } as CSSProperties}>
        <span className="head">{t('Attack')}</span>
        {variants.map((v) => (
          <span key={v} className="head">
            {t(v)}
          </span>
        ))}
        {target.cases.map((c) => (
          <div key={c.id} className="matrix-row">
            <details>
              <summary>{t(c.title)}</summary>
              <pre>{JSON.stringify(c.attack, null, 1)}</pre>
            </details>
            {variants.map((v) => (
              <div key={v}>
                <Pill result={c.results[v]!} />
                <Deltas result={c.results[v]!} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="hash">
        {variants.map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            title={target.hashes[v]}
            onClick={() =>
              download(
                `${target.id}-${v.replace(' ', '-')}.program.json`,
                JSON.stringify(target.variants[v], null, 2),
              )
            }
          >
            {t(v)} · {target.hashes[v]!.slice(0, 12)}… ↓
          </button>
        ))}
      </div>
      <p className="hint">
        {t(
          'Write your own attack in the same format and replay it: npm run cli world-run program.json attack.json',
        )}
      </p>
    </article>
  );
}

function AgentCard() {
  const t = useT();
  const byCase = new Map<string, AgentRow[]>();
  for (const row of coverage.agent.cases) byCase.set(row.id, [...(byCase.get(row.id) ?? []), row]);
  return (
    <article className="card target">
      <div className="kicker">{t('AI payment agent')}</div>
      <h3>{t('Invoice-paying agent')}</h3>
      <p className="muted">
        {t('The model reads an invoice and calls a pay tool on a test ledger.')}
      </p>
      <ul className="rule-list">
        <li>
          <b>transfer</b> {t('an executed payment breaks the frozen recipient or limit')}
        </li>
      </ul>
      <details>
        <summary>
          {t('{n} invoices × 2 configs, {m} as expected', {
            n: String(byCase.size),
            m: `${agentMatched}/${coverage.agent.cases.length}`,
          })}
        </summary>
        <div className="matrix" style={{ '--n': coverage.agent.variants.length } as CSSProperties}>
          <span className="head">{t('Invoice')}</span>
          {coverage.agent.variants.map((v) => (
            <span key={v} className="head">
              {t(v)}
            </span>
          ))}
          {[...byCase].map(([id, rows]) => (
            <div key={id} className="matrix-row">
              <span>{id}</span>
              {rows.map((r) => (
                <Pill
                  key={r.config}
                  result={{
                    expected: r.expected === 'true' ? 'violation' : 'no_violation',
                    outcome: r.violation ? 'violation' : 'no_violation',
                    ms: 0,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </details>
      <p className="hint">{t('Stub model: checks the checker, not the model.')}</p>
    </article>
  );
}

export function Coverage() {
  const t = useT();
  return (
    <section id="coverage" className="band">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t('WHAT WE CAN TEST TODAY')}</div>
          <h2>{t('Known attacks, real results.')}</h2>
        </div>
        <p>
          {t(
            'Each result is a replay: a fresh local NEAR chain, the real code, one attack, and the judge that decides payouts.',
          )}
        </p>
      </div>
      <p className="hint">
        {t(
          'Measured {date} · NEAR sandbox {v} · judge v{j} · {p}. Reproduce: npm run cli coverage',
          {
            date: new Date(coverage.measured).toLocaleString(),
            v: coverage.engine.sandbox,
            j: coverage.engine.judge,
            p: coverage.platform,
          },
        )}
      </p>
      <div className="targets">
        {coverage.targets.map((target) => (
          <TargetCard key={target.id} target={target} />
        ))}
        <AgentCard />
        <article className="card target next">
          <div className="kicker">{t('Next')}</div>
          <h3>{t('OutLayer apps')}</h3>
          <p className="muted">
            {t(
              'WASI apps that read and sign for NEAR accounts, replayed against the same local chain.',
            )}
          </p>
        </article>
      </div>
    </section>
  );
}

type Code = Spec['codes'][number];
type Picked = { code: Code; label: string; file?: string };

const rpcs = { mainnet: 'https://free.rpc.fastnear.com', testnet: 'https://test.rpc.fastnear.com' };
const sandbox =
  'https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/2.13.4/near-sandbox.tar.gz';

const yocto = (n: string) => {
  if (!/^\d+(\.\d{1,24})?$/.test(n)) return undefined;
  const [whole = '0', frac = ''] = n.split('.');
  return (BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, '0'))).toString();
};

async function deployedCode(account: string): Promise<Picked> {
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
  };
}

async function buildFile(file: File): Promise<Picked> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== '\0asm')
    throw new Error('This file is not a .wasm build');
  return {
    code: { source: 'wasm', sha256: await digest(bytes) },
    label: file.name,
    file: file.name,
  };
}

function CodeSource({
  code,
  host,
  picked,
  onPick,
}: {
  code: Code;
  host: string;
  picked?: Picked;
  onPick: (picked: Picked) => void;
}) {
  const { notify } = useEnv(),
    t = useT();
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (work: Promise<Picked>) => {
    setBusy(true);
    work.then(onPick, (error) => notify(errorText(error), true)).finally(() => setBusy(false));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    pick(deployedCode(account.trim()));
  };
  const label =
    picked?.label ??
    (code.source === 'wasm'
      ? t('template build')
      : `${code.account} @ ${code.block} · ${code.network}`);
  return (
    <div className="code-source">
      <p className="rule-line">
        {host} ← {label} <code>{(picked?.code ?? code).sha256.slice(0, 16)}…</code>
      </p>
      <form className="code-pick" onSubmit={submit}>
        <label className="field">
          {t('Deployed contract')}
          <input
            required
            placeholder="your-contract.near"
            pattern="[a-z0-9._\-]{2,64}"
            autoComplete="off"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <button type="submit" className="button secondary" disabled={busy}>
          {t('Copy its code')}
        </button>
      </form>
      <label className="field">
        {t('or a .wasm build')}
        <input
          type="file"
          accept=".wasm"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(buildFile(file));
          }}
        />
      </label>
    </div>
  );
}

function download(name: string, text: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function Launch() {
  const t = useT();
  const [pick, setPick] = useState({ target: coverage.targets[0]!.id, variant: '' });
  const target = coverage.targets.find((x) => x.id === pick.target)!;
  const variant = pick.variant || Object.keys(target.variants).at(-1)!;
  const [picked, setPicked] = useState<Record<string, Picked>>({});
  const [threshold, setThreshold] = useState('0.1');
  const [reward, setReward] = useState('5');
  const [hashed, setHashed] = useState({ program: '', hash: '' });
  const base = target.variants[variant]!;
  const mine = base.codes.flatMap((c) => picked[c.sha256] ?? []);
  let text = JSON.stringify(base);
  for (const c of base.codes)
    if (picked[c.sha256]) text = text.replaceAll(c.sha256, picked[c.sha256]!.code.sha256);
  const spec: Spec = JSON.parse(text);
  spec.codes = base.codes.map((c) => picked[c.sha256]?.code ?? c);
  const limit = yocto(threshold);
  if (limit) spec.rules = spec.rules.map((r) => (r.threshold ? { ...r, threshold: limit } : r));
  const program = JSON.stringify(spec, null, 2);
  const name = target.id;
  const setup = [
    '# ' + t('once: the CLI and a local NEAR chain (Node 22+)'),
    `git clone ${repository} && cd sealed-bounty && npm ci`,
    `curl -L ${sandbox} | tar -xz`,
    'export NEAR_SANDBOX_BIN=$PWD/near-sandbox',
    '# ' + t('test run: a fresh chain, your code, one attack, a verdict'),
    ...mine
      .filter((p) => p.file)
      .map((p) => `cp path/to/${p.file} fixtures/wasm/${p.code.sha256}.wasm`),
    `npm run cli -- world-run ~/Downloads/${name}.program.json ~/Downloads/${name}.attack.json`,
  ].join('\n');
  useEffect(() => {
    let current = true;
    programDigest(spec).then(
      (hash) => current && setHashed({ program, hash }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [program]);
  const hash = hashed.program === program ? hashed.hash : '…';
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
      </div>
      <div className="launch">
        <section className="card">
          <div className="kicker">1 · {t('START FROM A TEMPLATE')}</div>
          <div className="samples">
            {coverage.targets.map((x) => (
              <button
                key={x.id}
                type="button"
                className={'chip' + (x.id === target.id ? ' current' : '')}
                onClick={() => {
                  setPick({ target: x.id, variant: '' });
                  setPicked({});
                }}
              >
                {t(x.title)}
              </button>
            ))}
          </div>
          {Object.keys(target.variants).length > 1 && (
            <div className="samples">
              {Object.keys(target.variants).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={'chip' + (v === variant ? ' current' : '')}
                  onClick={() => {
                    setPick({ ...pick, variant: v });
                    setPicked({});
                  }}
                >
                  {t(v)}
                </button>
              ))}
            </div>
          )}
          <p className="hint">
            {t(
              'AI payment agents launch from the existing program flow: npm run cli program-create',
            )}
          </p>
        </section>
        <section className="card">
          <div className="kicker">2 · {t('YOUR CODE')}</div>
          <p className="hint">
            {t(
              'Every attack runs on a fresh local NEAR chain with a copy of this code. Your live contract is never touched.',
            )}
          </p>
          {base.codes.map((c) => (
            <CodeSource
              key={c.sha256}
              code={c}
              host={base.steps.find((s) => s.op === 'deploy' && s.code === c.sha256)?.id ?? ''}
              picked={picked[c.sha256]}
              onPick={(p) => setPicked((all) => ({ ...all, [c.sha256]: p }))}
            />
          ))}
          <p className="hint">
            {t(
              'Deployed contract: the code is copied at the last final block, from testnet for *.testnet, otherwise from mainnet. A .wasm build is the compiled contract (cargo near build); it does not have to be deployed, you hand it over with program.json.',
            )}
          </p>
          <p className="hint">
            {t(
              'The template setup stays the same, so your code needs the same methods. For another setup, edit steps in program.json.',
            )}
          </p>
        </section>
        <section className="card">
          <div className="kicker">3 · {t('WHO HOLDS WHAT')}</div>
          <Holders spec={spec} />
          <p className="hint">
            {t(
              'Protected accounts must not lose value to the attacker. The attacker gets one key and a budget.',
            )}
          </p>
        </section>
        <section className="card">
          <div className="kicker">4 · {t('WHAT COUNTS AS A BREAK')}</div>
          <RuleList spec={spec} />
          <label className="field">
            {t('Ignore moves smaller than (NEAR)')}
            <input
              value={threshold}
              inputMode="decimal"
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <label className="field">
            {t('Reward (NEAR)')}
            <input value={reward} inputMode="decimal" onChange={(e) => setReward(e.target.value)} />
          </label>
        </section>
        <section className="card review">
          <div className="kicker">5 · {t('REVIEW AND EXPORT')}</div>
          <p>
            {t('Program hash')}: <code>{hash}</code>
          </p>
          <p className="hint">
            {t(
              'Hunters see this hash on the bounty. Any change to code, balances or rules changes it.',
            )}
          </p>
          <div className="row">
            <button
              type="button"
              className="button"
              onClick={() => download(`${name}.program.json`, program)}
            >
              {t('Download program.json')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                download(`${name}.attack.json`, JSON.stringify(target.cases[0]!.attack, null, 2))
              }
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
          <pre>{`BOUNTY_REWARD_YOCTO=${yocto(reward) ?? '…'} npm run cli -- program-create ${name}.program.json`}</pre>
        </section>
      </div>
    </div>
  );
}
