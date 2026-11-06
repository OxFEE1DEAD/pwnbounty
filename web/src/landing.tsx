import type { CSSProperties } from 'react';
import { near, overview, type Entry } from './chain.js';
import { Coverage } from './checks.js';
import { useAsync, useEnv, type Meta } from './env.js';
import { useT } from './i18n.js';
import { Icon, type IconName } from './icons.js';

export const repository = 'https://github.com/OxFEE1DEAD/sealed-bounty';

const lead =
  'Bug bounties today end in weeks of triage and arguments about severity. Here the rule of a ' +
  'break is frozen up front, every attack is replayed by a machine, and the contract pays on ' +
  'the verdict.';
const notes = {
  testnet: 'Testnet only: rewards are test NEAR, not real money.',
  operator: 'Attacks are replayed on an operator machine. The operator can read your attack.',
  key: 'The operator holds the verdict key, so this page cannot prove a replay happened.',
  confirmed:
    'The verifier runs on OutLayer and reports confidential model inference as confirmed. ' +
    'Check the evidence before a private submission.',
  unconfirmed:
    'The verifier runs on OutLayer. Confidential model inference is not confirmed yet. ' +
    'Check the evidence before a private submission.',
};
const steps: [IconName, string, string][] = [
  [
    'lock',
    '01 FREEZE',
    'The project pins code, starting state and the rule of a break, and reserves the reward ' +
      'in escrow. Its hash is on chain.',
  ],
  [
    'mail',
    '02 SEAL',
    'The hacker encrypts the attack in the browser and commits its hash on NEAR. Nobody sees ' +
      'the attack before the commit is final.',
  ],
  [
    'play',
    '03 REPLAY',
    'The verifier replays it on a fresh sandbox chain, or runs the agent on a test ledger. ' +
      'The judge checks the frozen rule.',
  ],
  [
    'coins',
    '04 SETTLE',
    'A signed verdict reaches the contract. The first valid break is paid automatically; ' +
      'anything else earns zero.',
  ],
];
const sides: {
  icon: IconName;
  kicker: string;
  title: string;
  items: string[];
  links: [string, string][];
}[] = [
  {
    icon: 'bug',
    kicker: 'FOR HACKERS',
    title: 'Break it. Prove it. Get paid.',
    items: [
      'Pick an open program. What counts as a break is written down and frozen.',
      'Write the attack, test it on your machine, seal it in the browser.',
      'The contract pays the first valid break. Nobody triages your report.',
    ],
    links: [
      ['#/programs', 'Browse programs →'],
      ['#/me', 'My claims'],
    ],
  },
  {
    icon: 'tools',
    kicker: 'FOR PROJECTS',
    title: 'Pay only for a proved break.',
    items: [
      'Upload your contract, point to its code on mainnet, or describe your AI agent.',
      'Set the starting state and what counts as a break. A test run checks it before you pay.',
      'Reserve the reward. If nobody breaks it, take it back after the deadline.',
    ],
    links: [
      ['#/projects/new', 'Launch a program →'],
      ['#/projects', 'How it works for projects'],
    ],
  },
];
const targets = [
  [
    'CONTRACT',
    'Vault with user deposits',
    "A contract that holds other people's money.",
    'Broken build: caught (deposit 1, withdraw 10). Fixed build: passed.',
  ],
  [
    'TOKEN',
    'Wrapped NEAR',
    'The real wrap.near code, copied from mainnet.',
    '3 known attacks, no break found.',
  ],
  [
    'INTENTS',
    'NEAR Intents',
    'The real intents.near code. Also checks that a user is not blocked from their funds.',
    '3 known attacks, no break found.',
  ],
  [
    'AGENT WALLET',
    'Payment agent wallet',
    'The on-chain wallet an AI agent pays from.',
    'Full-access key: drained. Limited key: held.',
  ],
  [
    'AI AGENT',
    'Payment agent with a model',
    'An agent that reads invoices and pays them. Runs on OutLayer or on an operator machine.',
    'Crafted invoice on testnet: the weak agent paid 1 NEAR, the guarded one 0.',
  ],
];

export function trustNotes(meta: Meta): string[] {
  const list = meta.network === 'testnet' ? [notes.testnet] : [];
  if (meta.trust_mode === 'local-development') return [...list, notes.operator, notes.key];
  return [...list, meta.confidential_inference_verified ? notes.confirmed : notes.unconfirmed];
}

export function TrustNotice() {
  const { meta } = useEnv(),
    t = useT();
  return (
    <div className="notice">
      <div className="notice-head">
        <Icon name="warn" size={18} />
        {t(meta.network === 'testnet' ? 'TEST MODE' : 'BEFORE YOU SEND')}
      </div>
      <ul>
        {trustNotes(meta).map((note) => (
          <li key={note}>{t(note)}</li>
        ))}
      </ul>
    </div>
  );
}

export function Account({ name }: { name: string }) {
  const { chain } = useEnv();
  return (
    <a href={chain.accountUrl(name)} target="_blank" rel="noopener noreferrer">
      {name} ↗
    </a>
  );
}

function LastVerdict({ entries }: { entries?: Entry[] }) {
  const t = useT();
  const last = entries?.filter((entry) => entry.bounty.state === 'Paid').at(-1);
  if (!last) {
    return (
      <div className="verdict-card">
        <div className="verdict-bar">{t('LAST VERDICT')}</div>
        <p className="muted">
          {t(entries ? 'No payouts yet. The first proved break will appear here.' : 'Loading…')}
        </p>
      </div>
    );
  }
  return (
    <div className="verdict-card">
      <div className="verdict-bar">
        <span>
          {t('VERDICT · PROGRAM #')}
          {last.id}
        </span>
        <span>{t('VALID')}</span>
      </div>
      <dl>
        <dt>{t('payout')}</dt>
        <dd>
          {near(last.bounty.reward)} → <Account name={last.bounty.winner!} />
        </dd>
        <dt>{t('rule hash')}</dt>
        <dd>
          <code>{last.bounty.rules_hash.slice(0, 16)}…</code>
        </dd>
        <dt>{t('state')}</dt>
        <dd>{t('Paid by the contract')}</dd>
      </dl>
      <a href={'#/programs/' + last.id}>{t('Open the program →')}</a>
    </div>
  );
}

function Hero({ entries }: { entries?: Entry[] }) {
  const t = useT();
  return (
    <section className="hero">
      <div className="eyebrow">{t('AUTOMATED BUG BOUNTY ON NEAR')}</div>
      <h1>
        <span>{t('If it breaks,')}</span>
        <span>{t('it pays.')}</span>
      </h1>
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="lead">{t(lead)}</p>
          <div className="doors">
            <a className="door-button" href="#/programs">
              <Icon name="bug" size={32} />
              <span>
                <b>{t('I HACK')}</b>
                {t('find a program →')}
              </span>
            </a>
            <a className="door-button secondary" href="#/projects">
              <Icon name="tools" size={32} />
              <span>
                <b>{t('I BUILD')}</b>
                {t('launch a bounty →')}
              </span>
            </a>
          </div>
          <TrustNotice />
        </div>
        <LastVerdict entries={entries} />
      </div>
    </section>
  );
}

function Numbers({ entries, height }: { entries: Entry[]; height: bigint }) {
  const { meta } = useEnv(),
    t = useT();
  const stats = overview(entries, height, BigInt(meta.min_prepare_window_blocks));
  const items: [string, string][] = [
    [String(stats.total), 'programs launched'],
    [String(stats.open), 'open right now'],
    [near(stats.paid), 'paid to hackers'],
    [String(stats.breaks), 'breaks proved'],
  ];
  return (
    <>
      <section className="stats" aria-label={t('Live numbers')}>
        {items.map(([value, label]) => (
          <div key={label} className="stat">
            <strong>{value}</strong>
            <span>{t(label)}</span>
          </div>
        ))}
      </section>
      <p className="hint">
        {t('{network} · read from {contract} at the last final block', {
          network: meta.network,
          contract: meta.contract,
        })}
      </p>
    </>
  );
}

function HowItWorks() {
  const t = useT();
  return (
    <section id="how" className="band">
      <div className="eyebrow">{t('HOW IT WORKS')}</div>
      <h2>{t('Four steps. One frozen rule.')}</h2>
      <div className="steps">
        {steps.map(([icon, tag, text]) => (
          <div key={tag} className="card">
            <Icon name={icon} size={32} />
            <div className="step-number">{t(tag)}</div>
            <p>{t(text)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sides() {
  const t = useT();
  return (
    <section className="band sides" aria-label={t('Choose your side')}>
      {sides.map((side) => (
        <div key={side.kicker} className="card side">
          <Icon name={side.icon} size={48} />
          <div className="kicker">{t(side.kicker)}</div>
          <h2>{t(side.title)}</h2>
          <ol>
            {side.items.map((item) => (
              <li key={item}>{t(item)}</li>
            ))}
          </ol>
          <div className="row">
            {side.links.map(([href, label], index) => (
              <a key={href} href={href} className={index ? 'button secondary' : 'button'}>
                {t(label)}
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function Targets() {
  const t = useT();
  return (
    <section id="evidence" className="band">
      <div className="eyebrow">{t('WHAT CAN BE PUT UNDER A BOUNTY')}</div>
      <h2>{t('Contracts, tokens, intents and AI agents.')}</h2>
      <p className="muted">
        {t(
          'Each of these already went through our judge on known attacks. Below is what it found.',
        )}
      </p>
      <div className="tiles">
        {targets.map(([kind, title, text, result]) => (
          <div key={title} className="card tile">
            <span className="kicker">{t(kind!)}</span>
            <strong>{t(title!)}</strong>
            <span className="muted">{t(text!)}</span>
            <span>{t(result!)}</span>
          </div>
        ))}
      </div>
      <p className="row">
        <a href="#/docs/coverage">{t('Full results, case by case →')}</a>
      </p>
    </section>
  );
}

export function Landing() {
  const { chain } = useEnv(),
    t = useT();
  const data = useAsync(() => chain.allBounties(), []);
  return (
    <div className="wrap">
      <Hero entries={data.value?.entries} />
      {data.value && <Numbers entries={data.value.entries} height={data.value.height} />}
      {data.loading && !data.value && <p className="muted">{t('Loading chain data…')}</p>}
      {data.error && (
        <p className="error-text">
          {t('Chain data unavailable. Try again.')}{' '}
          <button type="button" className="chip" onClick={data.reload}>
            {t('Retry')}
          </button>
        </p>
      )}
      <HowItWorks />
      <Sides />
      <Targets />
    </div>
  );
}

const verdictChecks: [string, string][] = [
  ['1 Rules', 'the hash of program.json equals the rules hash on chain'],
  ['2 Code', 'the TDX quote names the runner build the escrow pinned'],
  ['3 Model', 'the runner checked the NEAR AI attestation against the pinned model policy'],
  ['4 Payout', 'the transfer is in the receipts of the claim transaction'],
];

export function Docs() {
  const { meta, chain } = useEnv(),
    t = useT();
  return (
    <div className="wrap">
      <section className="hunt-head">
        <div className="eyebrow">{t('DOCS')}</div>
        <h1>{t('Check everything yourself.')}</h1>
        <p className="lead">{t('Every number on this site comes from the chain.')}</p>
      </section>
      <section className="band">
        <div className="eyebrow">{t('DEPLOYMENTS')}</div>
        <h2>{t('Escrow and the TEE runner.')}</h2>
        <div className="table docs-table">
          <div className="table-row head">
            <span>{t('network')}</span>
            <span>{t('escrow contract')}</span>
            <span>{t('TEE runner')}</span>
            <span>{t('model')}</span>
          </div>
          <div className="table-row">
            <span>{meta.network}</span>
            <a href={chain.accountUrl(meta.contract)} target="_blank" rel="noopener noreferrer">
              {meta.contract} ↗
            </a>
            <code>
              {meta.runner.project} · {meta.runner.version.slice(0, 8)}
            </code>
            <span>{meta.model}</span>
          </div>
          <div className="table-row muted">
            <span>mainnet</span>
            <span>{t('not deployed')}</span>
            <span>-</span>
            <span>-</span>
          </div>
        </div>
        <p className="hint">
          {t('The escrow pins the runner build; every program pins the model policy hash.')}
        </p>
      </section>
      <section id="verify" className="band">
        <div className="eyebrow">{t('HOW TO CHECK A VERDICT')}</div>
        <h2>{t('Four checks, no trust.')}</h2>
        <ol className="wizard-steps" style={{ '--n': verdictChecks.length } as CSSProperties}>
          {verdictChecks.map(([title, text]) => (
            <li key={title}>
              <div className="now">
                <b>{t(title)}</b>
                <span>{t(text)}</span>
              </div>
            </li>
          ))}
        </ol>
        <pre>{`outlayer-verify tx <claim tx> --network ${meta.network} --api https://${meta.network === 'testnet' ? 'testnet-' : ''}api.outlayer.ai`}</pre>
      </section>
      <Coverage />
    </div>
  );
}
