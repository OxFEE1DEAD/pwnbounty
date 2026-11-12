import type { CSSProperties } from 'react';
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
  const t = useT();
  const shown = (result.deltas ?? []).filter((d) => abs(BigInt(d.amount)) > YOCTO / 100n);
  if (!shown.length && !result.rule) return null;
  return (
    <div className="deltas">
      {result.rule && <code>{t('broke: {rule}', { rule: result.rule })}</code>}
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
    <article id={target.id} className="card target">
      <div className="kicker">{t(concepts[target.concept] ?? target.concept)}</div>
      <h3>{t(target.title)}</h3>
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
      <div className="matrix" style={{ '--n': variants.length } as CSSProperties}>
        <span className="head">{t('Attack')}</span>
        {variants.map((v) => (
          <span key={v} className="head">
            {t(v)}
          </span>
        ))}
        {target.cases.map((c) => (
          <div key={c.id} className="matrix-row">
            <span>{t(c.title)}</span>
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
    </article>
  );
}

function AgentCard() {
  const t = useT();
  const byCase = new Map<string, AgentRow[]>();
  for (const row of coverage.agent.cases) byCase.set(row.id, [...(byCase.get(row.id) ?? []), row]);
  return (
    <article id="agent" className="card target">
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
      <p className="muted">
        {t('{n} invoices × 2 configs, {m} as expected', {
          n: String(byCase.size),
          m: `${agentMatched}/${coverage.agent.cases.length}`,
        })}
      </p>
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
            'We replay known attacks on a copy of each target. A vulnerable build should break, a fixed one should hold.',
          )}
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
