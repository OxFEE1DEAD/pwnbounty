import { near, overview, type Entry } from './chain.js';
import { useAsync, useEnv, type Meta } from './env.js';
import { useT } from './i18n.js';
import { CoverageBand } from './checks.js';

export const repository = 'https://github.com/OxFEE1DEAD/sealed-bounty';

const trust = {
  local:
    'Current verifier: local development. Browser encryption and testnet settlement have ' +
    'been demonstrated; this mode does not establish TEE execution or confidential model ' +
    'inference. Check the mode before submitting sensitive material.',
  confirmed:
    'Current verifier: OutLayer worker. Inference confidentiality is confirmed by the ' +
    'worker. Check the evidence before a private submission.',
  unconfirmed:
    'Current verifier: OutLayer worker. Inference confidentiality is not confirmed ' +
    'yet. Check the evidence before a private submission.',
};
const steps = [
  {
    tag: '01 / FREEZE',
    title: 'Freeze & fund',
    text:
      'The project fixes the code, the starting balances and what counts as a break. ' +
      'The reward waits in a NEAR contract.',
  },
  {
    tag: '02 / SEAL',
    title: 'Seal & commit',
    text:
      'The hunter encrypts the attack in the browser and records its hash on-chain ' +
      'before sending it.',
  },
  {
    tag: '03 / REPLAY',
    title: 'Replay & measure',
    text:
      'The verifier runs the attack on a fresh copy of the chain and measures who ' +
      'gained and who lost.',
  },
  {
    tag: '04 / SETTLE',
    title: 'Settle & disclose',
    text:
      'A signed verdict settles the bounty. Only the project team can decrypt the ' +
      'reproduction.',
  },
];
const problems = [
  [
    'Hunters wait and hope.',
    'Severity is argued after the fact, and the payout depends on the project agreeing.',
  ],
  [
    'Projects drown in noise.',
    'Reports arrive as prose and screenshots; reproducing each one costs engineer time.',
  ],
  ['Exploits leak.', 'A working attack sent in the clear can be copied before it is fixed.'],
];
const copy = {
  lead:
    'Projects freeze their code and fund a reward. Hunters send an encrypted attack. A ' +
    'fresh copy of the chain replays it, and the contract pays only if value really moved.',
  intro:
    'One judge for every project: the attacker gains what a protected account loses, a ' +
    'protected account loses value, or a protected withdrawal stops working.',
  paid:
    'Measured on the vulnerable vault build: vault −9 NEAR, attacker +9 NEAR, threshold ' +
    '0.1 NEAR. The contract pays the hunter after the signed verdict.',
  zero:
    'A story, a screenshot or a failed call is not a break. The same attack on the fixed ' +
    'build moves nothing, so no reward is due.',
};
const sceneLabels = ['FROZEN RULE', 'SEALED ATTACK', 'MEASURED VALUE', 'PAID ON NEAR'];

export function trustText(meta: Meta): string {
  if (meta.trust_mode === 'local-development') return trust.local;
  return meta.confidential_inference_verified ? trust.confirmed : trust.unconfirmed;
}

export function TrustNotice() {
  const { meta } = useEnv(),
    t = useT();
  return <p className="notice">{t(trustText(meta))}</p>;
}

export function Account({ name }: { name: string }) {
  const { chain } = useEnv();
  return (
    <a href={chain.accountUrl(name)} target="_blank" rel="noopener noreferrer">
      {name} ↗
    </a>
  );
}

function EvidenceEnvelope() {
  const t = useT();
  return (
    <div className="envelope-scene" role="img" aria-label={t('An attack sealed in an envelope')}>
      <div className="paper">
        <b>ATTACK #0042</b>
        <span>TARGET: vault.near</span>
        <span>deposit(1 NEAR)</span>
        <span>withdraw(10 NEAR)</span>
      </div>
      <div className="envelope" />
      <div className="seal">SB</div>
      <div className="scene-label">
        {sceneLabels.map((label) => (
          <span key={label}>{t(label)}</span>
        ))}
      </div>
    </div>
  );
}

function Hero() {
  const t = useT();
  return (
    <section className="hero">
      <div>
        <div className="eyebrow">{t('SEALED BUG BOUNTIES · NEAR')}</div>
        <h1>
          {t('A bug bounty that pays')}
          <br />
          {t('for a proved break.')}
        </h1>
        <p className="lead">{t(copy.lead)}</p>
        <div className="hero-actions">
          <a className="button" href="#/hunt">
            {t('Hunt a bounty →')}
          </a>
          <a className="button secondary" href="#/launch">
            {t('Launch a bounty')}
          </a>
        </div>
        <p className="mini">
          {t('The replay decides. Claims and severity debates earn zero.')}{' '}
          <a href="#/coverage">{t('See what it checks →')}</a>
        </p>
      </div>
      <EvidenceEnvelope />
    </section>
  );
}

function HowItWorks() {
  const t = useT();
  return (
    <section id="how" className="band">
      <div className="section-head">
        <div>
          <div className="eyebrow">01—04 / THE ROUTE</div>
          <h2>{t('A bounty that pays for a measured result.')}</h2>
        </div>
        <p>{t(copy.intro)}</p>
      </div>
      <div className="steps">
        {steps.map((step) => (
          <div key={step.tag} className="card">
            <div className="step-number">{step.tag}</div>
            <h3>{t(step.title)}</h3>
            <p>{t(step.text)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Problem() {
  const t = useT();
  return (
    <section className="band">
      <div className="eyebrow">{t('THE PROBLEM')}</div>
      <h2>{t('Bug bounties run on trust.')}</h2>
      <div className="steps three">
        {problems.map(([title, text]) => (
          <div key={title} className="card">
            <h3>{t(title!)}</h3>
            <p>{t(text!)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Doors() {
  const t = useT();
  return (
    <section className="band">
      <div className="eyebrow">{t('TWO SIDES')}</div>
      <h2>{t('Pick your side.')}</h2>
      <div className="outcomes">
        <div className="card door">
          <div className="kicker">{t('FOR HUNTERS')}</div>
          <h3>{t('Break it, prove it, get paid.')}</h3>
          <p>
            {t(
              'Pick an open bounty, test the attack locally, seal it. The replay decides, so nobody can argue the verdict.',
            )}
          </p>
          <a className="button" href="#/hunt">
            {t('Hunt a bounty →')}
          </a>
        </div>
        <div className="card door">
          <div className="kicker">{t('FOR PROJECTS')}</div>
          <h3>{t('Pay only for proved breaks.')}</h3>
          <p>
            {t(
              'Describe your contract, token, intents app or agent as a program. Hunters attack a fresh copy, never your live funds.',
            )}
          </p>
          <a className="button secondary" href="#/launch">
            {t('Launch a bounty →')}
          </a>
        </div>
      </div>
    </section>
  );
}

function OutcomePair() {
  const t = useT();
  return (
    <section className="band">
      <div className="eyebrow">THE CHECK</div>
      <h2>{t('The replay decides.')}</h2>
      <div className="outcomes">
        <div className="card outcome paid">
          <div className="symbol">↗</div>
          <h3>{t('Rule broken. Reward paid.')}</h3>
          <p>{t(copy.paid)}</p>
          <div className="evidence">rule: take · verdict: violation</div>
        </div>
        <div className="card outcome zero">
          <div className="symbol">0</div>
          <h3>{t('A story is worth zero.')}</h3>
          <p>{t(copy.zero)}</p>
          <div className="evidence">fixed build · verdict: no_violation · reward: 0</div>
        </div>
      </div>
    </section>
  );
}

function ChainStats({ entries, height }: { entries: Entry[]; height: bigint }) {
  const { meta } = useEnv(),
    t = useT();
  const stats = overview(entries, height, BigInt(meta.min_prepare_window_blocks));
  const amount = (value: bigint) => near(value).replace(/ NEAR$/, '');
  const items: [string, string][] = [
    [String(stats.total), 'Programs'],
    [String(stats.open), 'Open'],
    [amount(stats.escrowed), 'NEAR escrowed'],
    [amount(stats.paid), 'NEAR paid'],
    [String(stats.winners), 'Winners'],
  ];
  return (
    <div className="stats">
      {items.map(([value, label]) => (
        <div key={label} className="card stat">
          <strong>{value}</strong>
          <span>{t(label)}</span>
        </div>
      ))}
    </div>
  );
}

function RecentPayouts({ entries }: { entries: Entry[] }) {
  const t = useT();
  const paid = entries
    .filter((entry) => entry.bounty.state === 'Paid' && entry.bounty.winner)
    .reverse()
    .slice(0, 5);
  return (
    <div className="payouts">
      <div className="payout-head">
        <h3>{t('Recent payouts')}</h3>
        <span>{t("Each row links to the winner's account on NearBlocks.")}</span>
      </div>
      {!paid.length && (
        <p className="muted">
          {t('No payouts yet. The first executed violation will appear here.')}
        </p>
      )}
      {paid.map((entry) => (
        <div key={entry.id} className="payout-row">
          <Account name={entry.bounty.winner!} />
          <span>
            {t('Program #')}
            {entry.id}
          </span>
          <strong>{near(entry.bounty.reward)}</strong>
        </div>
      ))}
    </div>
  );
}

function LiveEvidence() {
  const { chain } = useEnv(),
    t = useT();
  const data = useAsync(() => chain.allBounties(), []);
  return (
    <section id="evidence" className="band">
      <div className="section-head">
        <div>
          <div className="eyebrow">FINALIZED NEAR STATE</div>
          <h2>{t('On-chain, not on faith.')}</h2>
        </div>
        <p>{t('Finalized NEAR state. Refreshes when the page loads.')}</p>
      </div>
      {data.loading && <p className="muted">{t('Loading chain data…')}</p>}
      {data.error && (
        <p className="error-text">
          {t('Chain data unavailable. Try again.')}{' '}
          <button type="button" className="chip" onClick={data.reload}>
            {t('Retry')}
          </button>
        </p>
      )}
      {data.value && (
        <>
          <ChainStats entries={data.value.entries} height={data.value.height} />
          <RecentPayouts entries={data.value.entries} />
        </>
      )}
    </section>
  );
}

export function Landing() {
  return (
    <div className="wrap">
      <Hero />
      <Problem />
      <HowItWorks />
      <OutcomePair />
      <CoverageBand />
      <Doors />
      <LiveEvidence />
      <TrustNotice />
    </div>
  );
}
