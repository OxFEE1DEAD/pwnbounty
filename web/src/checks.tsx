import { canonical, digest } from './crypto.js';
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
  methods?: Record<string, string[]>;
  cases: { id: string; title: string; attack: unknown; results: Record<string, Result> }[];
};
type AgentRow = {
  id: string;
  kind: string;
  config: string;
  expected: string;
  violation: boolean;
  invoice: string;
  transfers?: string;
};
type Group = 'hacked' | 'fixed' | 'held';
type Attack = {
  id: string;
  title: string;
  text: string;
  type: string;
  results: [variant: string, result: Result, detail: string][];
};

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
const statuses: Record<Outcome, string> = {
  violation: 'HACKED',
  no_violation: 'HELD',
  invalid_attack: 'INVALID',
  limit: 'OVER LIMIT',
  inconclusive: 'UNDECIDED',
  infra_error: 'INFRA ERROR',
};
const groups: [Group, string][] = [
  ['hacked', 'Hacked, reward'],
  ['fixed', 'Fixed after break'],
  ['held', 'Not hacked'],
];
const sources: Record<string, string> = {
  vault: 'contract/vault',
  'agent-wallet': 'contract/policy-wallet',
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

export const targets = coverage.targets;

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

const groupOf = (results: Attack['results']): Group =>
  results.at(-1)![1].outcome === 'violation'
    ? 'hacked'
    : results.some(([, r]) => r.outcome === 'violation')
      ? 'fixed'
      : 'held';

function sourceOf(target: Target): string {
  const code = Object.values(target.variants)[0]!
    .codes.filter((c) => c.account)
    .at(-1);
  if (!code) return `${repository}/tree/main/${sources[target.id] ?? 'fixtures'}`;
  return `https://${code.network === 'testnet' ? 'testnet.' : ''}nearblocks.io/address/${code.account}`;
}

function view(text: string, type: string) {
  window.open(URL.createObjectURL(new Blob([text], { type })), '_blank', 'noopener');
}

function Attacks({ attacks }: { attacks: Attack[] }) {
  const t = useT();
  const sorted = groups.map(([group, name]) => ({
    group,
    name,
    list: attacks.filter((a) => groupOf(a.results) === group),
  }));
  return (
    <div className="attack-groups">
      <p className="attack-counts">
        {sorted.map(({ group, name, list }) => (
          <span key={group} className={group}>
            <b>{list.length}</b> {t(name)}
          </span>
        ))}
      </p>
      {sorted
        .filter(({ list }) => list.length)
        .map(({ group, name, list }) => (
          <section key={group} className={group}>
            <div className="kicker">{t(name)}</div>
            {list.map((a) => (
              <div key={a.id} className="attack">
                <button type="button" className="link" onClick={() => view(a.text, a.type)}>
                  {t(a.title)}
                  {'\u00a0↗'}
                </button>
                <ol>
                  {a.results.map(([variant, r, detail]) => (
                    <li key={variant}>
                      <span>{t(variant)}</span>
                      <b
                        className={r.outcome}
                        title={
                          r.outcome === r.expected
                            ? undefined
                            : t('expected {x}', { x: statuses[r.expected] })
                        }
                      >
                        {statuses[r.outcome]}
                        {r.outcome !== r.expected && ' ✗'}
                      </b>
                      <span>{detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ))}
    </div>
  );
}

function TargetCard({ target }: { target: Target }) {
  const t = useT();
  const variants = Object.keys(target.variants);
  const rules = Object.values(target.variants)[0]!.rules;
  const detail = (r: Result) =>
    r.outcome === 'violation'
      ? [
          r.rule,
          ...(r.deltas ?? [])
            .filter((d) => abs(BigInt(d.amount)) > YOCTO / 100n)
            .map(
              (d) =>
                `${d.account.replace('.test.near', '')} ${near(d.amount)} ${d.token === 'NEAR' ? 'NEAR' : 'wNEAR'}`,
            ),
        ].join(' · ')
      : '';
  const attacks = target.cases.map((c): Attack => ({
    id: c.id,
    title: c.title,
    text: JSON.stringify(c.attack, null, 2),
    type: 'application/json',
    results: variants.map((v) => [v, c.results[v]!, detail(c.results[v]!)]),
  }));
  return (
    <article id={target.id} className="card target">
      <div className="kicker">{t(concepts[target.concept] ?? target.concept)}</div>
      <h3>
        <a href={sourceOf(target)} target="_blank" rel="noopener noreferrer">
          {t(target.title)}
          {'\u00a0↗'}
        </a>
      </h3>
      <p className="muted">{t(target.source)}</p>
      <div className="break-rules">
        <span className="kicker">{t('A break is')}</span>
        <ul className="rule-list">
          {rules.map((r) => (
            <li key={r.id}>
              <b>{r.id}</b> {t(ruleNames[r.id] ?? r.id)}
              {r.threshold && ` > ${near(r.threshold).replace('+', '')} NEAR`}
            </li>
          ))}
        </ul>
      </div>
      <Attacks attacks={attacks} />
      <div className="hash">
        {variants.map((v) => (
          <button
            key={v}
            type="button"
            className="link"
            title={target.hashes[v]}
            onClick={() =>
              download(
                `${target.id}-${v.replace(' ', '-')}.program.json`,
                JSON.stringify(target.variants[v], null, 2),
              )
            }
          >
            {t('{v} program', { v: t(v) })} · {target.hashes[v]!.slice(0, 12)}… ↓
          </button>
        ))}
      </div>
    </article>
  );
}

function AgentCard() {
  const t = useT();
  const byCase = new Map<string, AgentRow[]>();
  for (const row of coverage.agent.cases) byCase.set(row.id, [...(byCase.get(row.id) ?? []), row]);
  const attacks = [...byCase].map(([id, rows]): Attack => ({
    id,
    title: id,
    text: rows[0]!.invoice,
    type: 'text/plain',
    results: rows.map((r) => [
      r.config,
      {
        expected: r.expected === 'true' ? 'violation' : 'no_violation',
        outcome: r.violation ? 'violation' : 'no_violation',
        ms: 0,
      },
      r.violation && r.transfers ? `paid ${r.transfers}` : '',
    ]),
  }));
  return (
    <article id="agent" className="card target">
      <div className="kicker">{t('AI payment agent')}</div>
      <h3>
        <a
          href={`${repository}/blob/main/fixtures/cases.json`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('Invoice-paying agent')}
          {'\u00a0↗'}
        </a>
      </h3>
      <p className="muted">
        {t('The model reads an invoice and calls a pay tool on a test ledger.')}
      </p>
      <div className="break-rules">
        <span className="kicker">{t('A break is')}</span>
        <ul className="rule-list">
          <li>
            <b>transfer</b> {t('an executed payment breaks the frozen recipient or limit')}
          </li>
        </ul>
      </div>
      <Attacks attacks={attacks} />
      <p className="hint">
        {t(
          'Stub model: checks the checker, not the model. Runs with real models and TEE attestations are on',
        )}{' '}
        <a href="#/programs">{t('the live programs')}</a>.
      </p>
    </article>
  );
}

export function Coverage() {
  const t = useT();
  return (
    <section id="coverage" className="band">
      <div className="section-head">
        <div>
          <div className="eyebrow">{t('TEST CORPUS')}</div>
          <h2>{t('Our test attacks, replayed.')}</h2>
        </div>
        <p>
          {t(
            'Attacks we wrote to test the checker, not incidents from the wild. Each one replays on a local copy of the target: a vulnerable build has to break, a fixed one has to hold.',
          )}{' '}
          <a href="#/incidents">{t('Real incidents')}</a> ·{' '}
          <a
            href={`${repository}/blob/main/verifier/src/world/judge.ts`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('judge\u00a0code')}
            {'\u00a0↗'}
          </a>
          <br />
          <span className="hint">
            {t('Recorded {date} on {platform}, sandbox {sandbox}.', {
              date: coverage.measured.slice(0, 10),
              platform: coverage.platform,
              sandbox: coverage.engine.sandbox,
            })}
          </span>
        </p>
      </div>
      <div className="targets">
        {coverage.targets.map((target) => (
          <TargetCard key={target.id} target={target} />
        ))}
        <AgentCard />
      </div>
    </section>
  );
}

export function CoverageTable() {
  const t = useT();
  const rows: [string, string, string, [string, number, number][]][] = [
    ...coverage.targets.map((target): [string, string, string, [string, number, number][]] => [
      target.id,
      target.title,
      concepts[target.concept] ?? target.concept,
      Object.keys(target.variants).map((variant) => [
        variant,
        target.cases.filter((c) => c.results[variant]?.outcome === 'violation').length,
        target.cases.length,
      ]),
    ]),
    [
      'agent',
      'Invoice-paying agent',
      'AI payment agent',
      coverage.agent.variants.map((variant) => {
        const cases = coverage.agent.cases.filter((r) => r.config === variant);
        return [variant, cases.filter((r) => r.violation).length, cases.length];
      }),
    ],
  ];
  return (
    <div className="table">
      {rows.map(([id, title, kind, variants]) => (
        <a key={id} href={'#/docs/' + id} className="table-row">
          <strong>{t(title)}</strong>
          <span className="muted">{t(kind)}</span>
          <span className="samples">
            {variants.map(([variant, broken, total]) => (
              <span key={variant} className={'pill' + (broken ? ' violation' : '')}>
                {t(variant)} ·{' '}
                {broken
                  ? t('{n} of {total} attacks broke it', {
                      n: String(broken),
                      total: String(total),
                    })
                  : t('held all {total} attacks', { total: String(total) })}
              </span>
            ))}
          </span>
        </a>
      ))}
    </div>
  );
}

export function download(name: string, text: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
