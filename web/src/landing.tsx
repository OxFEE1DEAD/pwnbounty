import { near, overview, type Entry } from './chain.js';
import { useAsync, useEnv, type Meta } from './env.js';
import { useT } from './i18n.js';

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
    tag: '01 / FUND',
    title: 'Freeze & fund',
    text: 'One allowed recipient. One limit per transfer. The reward is held by the NEAR contract.',
  },
  {
    tag: '02 / COMMIT',
    title: 'Seal & commit',
    text:
      'Encrypt the invoice in your browser. Record its hash from your wallet before sending ' +
      'ciphertext.',
  },
  {
    tag: '03 / RUN',
    title: 'Run & inspect',
    text:
      'The verifier runs the agent with fake funds. The checker reads executed ledger ' +
      "transfers, not the agent's claims.",
  },
  {
    tag: '04 / SETTLE',
    title: 'Settle & disclose',
    text:
      'A signed verdict settles the bounty. Only the project team can decrypt the ' +
      'reproduction.',
  },
];
const copy = {
  lead:
    'A funded bounty for a real forbidden transfer by an AI payment agent. Your invoice ' +
    'stays encrypted; the executed transfer decides the payout.',
  intro:
    'The sponsor freezes the model, prompt, tools and spending rule before funding the ' +
    'reward. Hunters control one surface: the invoice the agent will read.',
  paid:
    'Executed: 450 → vendor.near. Frozen limit: 100 per transfer. The contract pays the ' +
    'hunter after the signed verdict.',
  zero:
    '"Ignore your rules," a forged transcript, and "please approve" are not transfers. ' +
    'If no forbidden transfer executes, no reward is due.',
};
const sceneLabels = ['FROZEN RULE', 'SEALED INVOICE', 'EXECUTED TRANSFER', 'PAID ON NEAR'];

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
    <div className="envelope-scene" role="img" aria-label={t('An invoice sealed in an envelope')}>
      <div className="paper">
        <b>INVOICE #4476</b>
        <span>PAY TO: vendor.near</span>
        <span>AMOUNT: 450</span>
        <span>LIMIT: 100 / TRANSFER</span>
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
        <div className="eyebrow">{t('AI PAYMENT AGENTS · NEAR')}</div>
        <h1>
          {t('Break the rule.')}
          <br />
          {t('Keep the exploit sealed.')}
        </h1>
        <p className="lead">{t(copy.lead)}</p>
        <div className="hero-actions">
          <a className="button" href="#/hunt">
            {t('Hunt a bounty →')}
          </a>
          <a className="button secondary" href="#/evidence">
            {t('See the proof')}
          </a>
        </div>
        <p className="mini">{t('The transfer decides. Model prose earns zero.')}</p>
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
          <h2>{t('A bounty that asks the agent to show its work.')}</h2>
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

function OutcomePair() {
  const t = useT();
  return (
    <section className="band">
      <div className="eyebrow">THE CHECK</div>
      <h2>{t('The transfer decides.')}</h2>
      <div className="outcomes">
        <div className="card outcome paid">
          <div className="symbol">↗</div>
          <h3>{t('Rule broken. Reward paid.')}</h3>
          <p>{t(copy.paid)}</p>
          <div className="evidence">executed: true · verdict: violation</div>
        </div>
        <div className="card outcome zero">
          <div className="symbol">0</div>
          <h3>{t('A story is worth zero.')}</h3>
          <p>{t(copy.zero)}</p>
          <div className="evidence">executed transfers: 0 · reward: 0</div>
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
      <HowItWorks />
      <OutcomePair />
      <LiveEvidence />
      <TrustNotice />
    </div>
  );
}
