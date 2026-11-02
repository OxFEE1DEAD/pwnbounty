import { useEffect, useState, type CSSProperties } from 'react';
import { canonical, digest } from './crypto.js';
import { useT } from './i18n.js';
import data from './checks.json';

type Outcome =
  'violation' | 'no_violation' | 'limit' | 'invalid_attack' | 'inconclusive' | 'infra_error';
type Delta = { account: string; token: string; amount: string };
type Result = { expected: Outcome; outcome: Outcome; rule?: string; deltas?: Delta[]; ms: number };
export type Spec = {
  title: string;
  steps: { op: string; id?: string; near?: string; role?: string; code?: string }[];
  codes: { source: string; sha256: string; account?: string; block?: string }[];
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
          <div key={a.id} className="payout-row">
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
const results = coverage.targets.flatMap((t) => t.cases.flatMap((c) => Object.values(c.results)));
export const totals = {
  projects: coverage.targets.length + 1,
  runs: results.length + coverage.agent.cases.length,
  matched: results.filter((r) => r.outcome === r.expected).length + agentMatched,
  breaks: results.filter((r) => r.outcome === 'violation').length,
};

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
      <div
        className="matrix"
        style={{ '--n': variants.length } as CSSProperties}
      >
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

export function CoverageBand() {
  const t = useT();
  return (
    <section id="coverage" className="band">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t('COVERAGE')}</div>
          <h2>{t('Not only agents. Any NEAR project with value at stake.')}</h2>
        </div>
        <p>
          {t(
            '{runs} replays across {projects} projects, {matched} as expected, {breaks} breaks caught.',
            {
              runs: String(totals.runs),
              projects: String(totals.projects),
              matched: String(totals.matched),
              breaks: String(totals.breaks),
            },
          )}
        </p>
      </div>
      <div className="tiles">
        {coverage.targets.map((target) => (
          <a key={target.id} className="card tile" href="#/coverage">
            <span className="kicker">{t(concepts[target.concept] ?? target.concept)}</span>
            <strong>{t(target.title)}</strong>
            <span className="muted">{t(target.source)}</span>
          </a>
        ))}
        <a className="card tile" href="#/coverage">
          <span className="kicker">{t('AI payment agent')}</span>
          <strong>{t('Invoice-paying agent')}</strong>
          <span className="muted">{t('Model, prompt and tools frozen')}</span>
        </a>
      </div>
    </section>
  );
}

export function Coverage() {
  const t = useT();
  return (
    <div className="wrap">
      <div className="hunt-head">
        <div className="eyebrow">{t('COVERAGE')}</div>
        <h1>{t('What a sealed bounty can check today')}</h1>
        <p className="lead">
          {t(
            'Each result is a replay: a fresh local NEAR chain, the real code, one attack, and the judge that decides payouts.',
          )}
        </p>
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
      </div>
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
    </div>
  );
}

async function sha256File(file: File) {
  return digest(new Uint8Array(await file.arrayBuffer()));
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
  const [code, setCode] = useState<{ name: string; sha256: string }>();
  const [threshold, setThreshold] = useState('0.1');
  const [reward, setReward] = useState('5');
  const [hashed, setHashed] = useState({ program: '', hash: '' });
  const base = target.variants[variant]!;
  const yocto = (n: string) => {
    const [whole = '0', frac = ''] = n.split('.');
    return (BigInt(whole) * YOCTO + BigInt((frac + '0'.repeat(24)).slice(0, 24))).toString();
  };
  const replaced = base.codes.find((c) => c.source === 'wasm')?.sha256;
  const spec: Spec = JSON.parse(
    code && replaced
      ? JSON.stringify(base).replaceAll(replaced, code.sha256)
      : JSON.stringify(base),
  );
  if (/^\d+(\.\d{1,24})?$/.test(threshold))
    spec.rules = spec.rules.map((r) => (r.threshold ? { ...r, threshold: yocto(threshold) } : r));
  const program = JSON.stringify(spec, null, 2);
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
                  setCode(undefined);
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
                  onClick={() => setPick({ ...pick, variant: v })}
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
          {spec.codes.map((c) => (
            <p key={c.sha256} className="rule-line">
              {c.source === 'wasm' ? t('Contract build') : `${c.account} @ ${c.block}`}{' '}
              <code>{c.sha256.slice(0, 16)}…</code>
            </p>
          ))}
          {replaced && (
            <label className="field">
              {t('Replace with your .wasm build (hashed in this browser)')}
              <input
                type="file"
                accept=".wasm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) sha256File(file).then((sha256) => setCode({ name: file.name, sha256 }));
                }}
              />
            </label>
          )}
          {code && <p className="hint">{t('Uploaded: {name}', { name: code.name })}</p>}
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
              onClick={() => download(`${target.id}.program.json`, program)}
            >
              {t('Download program.json')}
            </button>
          </div>
          <pre>
            {`npm run cli world-run ${target.id}.program.json attack.json\nnpm run cli program-create ${target.id}.program.json\n# ${t('reward')}: ${reward} NEAR`}
          </pre>
          <p className="hint">
            {t(
              'Replay your own attack locally first, then program-create funds the bounty on NEAR and hunters see it in the hunt.',
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
