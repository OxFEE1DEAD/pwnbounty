import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HunterWallet } from './wallet.js';
import { Chain, near, type Bounty, type Entry } from './chain.js';
import {
  EnvContext,
  errorText,
  loadMeta,
  useAsync,
  useEnv,
  ChainVerifier,
  type Env,
  type Meta,
  type Note,
  type TeamDraft,
} from './env.js';
import type { ChainReader, HunterClaim } from './ports.js';
import { Icon, type IconName } from './icons.js';
import { useT } from './i18n.js';
import { Hunt } from './hunt.js';
import { Launch } from './launch.js';
import { MyProgramsPage, Projects } from './projects.js';
import { Account, Docs, Landing, repository } from './landing.js';
import { Incidents } from './incidents.js';
import '../style.css';

type Route =
  'home' | 'programs' | 'program' | 'me' | 'projects' | 'mine' | 'launch' | 'docs' | 'incidents';
interface Place {
  route: Route;
  id?: string;
  anchor?: string;
}
interface Side {
  label: string;
  title: string;
  icon: IconName;
  href: string;
  links: [string, string, Route[]][];
}
const stateLabels: Record<string, string> = {
  Paid: 'Paid',
  Pending: 'Payout in progress',
  Retryable: 'Payout failed',
};
const sides: Side[] = [
  {
    label: 'For hackers',
    title: 'FOR HACKERS',
    icon: 'bug',
    href: '#/programs',
    links: [
      ['#/programs', 'Programs', ['programs', 'program']],
      ['#/me', 'My claims', ['me']],
    ],
  },
  {
    label: 'For projects',
    title: 'FOR PROJECTS',
    icon: 'tools',
    href: '#/projects',
    links: [
      ['#/projects', 'Overview', ['projects']],
      ['#/projects/mine', 'My programs', ['mine']],
      ['#/projects/new', 'Launch a program', ['launch']],
    ],
  },
];
const sideOf = (route: Route) =>
  sides.find((side) => side.links.some(([, , r]) => r.includes(route)));

function readHash(): Place {
  const [name = '', sub] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'programs') return sub ? { route: 'program', id: sub } : { route: 'programs' };
  if (name === 'projects')
    return sub === 'new'
      ? { route: 'launch' }
      : sub === 'mine'
        ? { route: 'mine' }
        : { route: 'projects', anchor: sub };
  if (name === 'me') return { route: 'me' };
  if (name === 'docs') return { route: 'docs', anchor: sub };
  if (name === 'incidents') return { route: 'incidents' };
  return { route: 'home', anchor: name || undefined };
}

function useRoute(): Place {
  const [place, setPlace] = useState(() => readHash());
  useEffect(() => {
    const change = () => {
      const next = readHash();
      setPlace(next);
      window.requestAnimationFrame(() => {
        const target = next.anchor && document.getElementById(next.anchor);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
        else window.scrollTo(0, 0);
      });
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return place;
}

function Brand() {
  return (
    <a className="brand" href="#/">
      <Icon name="lock" size={22} />
      PWNBOUNTY
    </a>
  );
}

function Header({ route }: { route: Route }) {
  const { meta, account, connect, disconnect, notify } = useEnv(),
    t = useT();
  const side = sideOf(route);
  const wallet = () => {
    if (account) location.hash = '#/me';
    else connect().catch((error) => notify(errorText(error), true));
  };
  return (
    <>
      <header className="top wrap">
        <Brand />
        <nav aria-label={t('Main navigation')}>
          {sides.map((item) => (
            <a key={item.href} href={item.href} className={item === side ? 'current' : ''}>
              <Icon name={item.icon} />
              {t(item.label)}
            </a>
          ))}
        </nav>
        <div className="wallet-box">
          <details className="net">
            <summary>
              <Icon name="near" size={14} />
              {meta.network}
            </summary>
            <div className="menu">
              {['testnet', 'mainnet'].map((network) => (
                <a
                  key={network}
                  href={`?network=${network}${location.hash}`}
                  className={network === meta.network ? 'current' : ''}
                >
                  <Icon name="near" size={12} />
                  {network}
                </a>
              ))}
            </div>
          </details>
          <button type="button" className="wallet" onClick={wallet}>
            {account ?? t('Connect wallet')}
          </button>
          {account && (
            <button
              type="button"
              className="out"
              title={t('Log out')}
              aria-label={t('Log out')}
              onClick={() => disconnect().catch((error) => notify(errorText(error), true))}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </header>
      {side && (
        <nav className="subnav wrap" aria-label={t(side.label)}>
          <span className="pixel">{t(side.title)}</span>
          {side.links.map(([href, label, routes]) => (
            <a key={href} href={href} className={routes.includes(route) ? 'current' : ''}>
              {t(label)}
            </a>
          ))}
        </nav>
      )}
    </>
  );
}

function claimStatus(
  { commitment }: HunterClaim,
  bounty: Bounty | undefined,
  hunter: string,
): string {
  if (!commitment.settled) return 'Waiting for the verdict';
  if (!commitment.verdict?.valid) return 'No break, no reward';
  if (bounty?.winner !== hunter) return 'Valid, but another hunter was first';
  return stateLabels[bounty.state] ?? bounty.state;
}

async function loadMine(chain: ChainReader, account: string) {
  const [{ entries }, claims] = await Promise.all([
    chain.allBounties(),
    chain.hunterClaims(account, 0, 50),
  ]);
  const bounties = new Map(entries.map((entry) => [entry.id, entry.bounty]));
  return {
    wins: entries.filter((entry) => entry.bounty.winner === account),
    attempts: claims
      .map((claim) => {
        const bounty = bounties.get(claim.bounty);
        return { claim, bounty, status: claimStatus(claim, bounty, account) };
      })
      .reverse(),
  };
}

const earned = (wins: Entry[]) =>
  wins
    .filter((entry) => entry.bounty.state === 'Paid')
    .reduce((sum, entry) => sum + BigInt(entry.bounty.reward), 0n);

type Attempt = { claim: HunterClaim; bounty?: Bounty; status: string };

function Claims({ rows, reload }: { rows: Attempt[]; reload(): void }) {
  const { wallet, account, notify } = useEnv(),
    t = useT();
  const [busy, setBusy] = useState(false);
  const retry = (id: string) => {
    setBusy(true);
    wallet
      .retryPayment(id, account!)
      .then(reload, (error) => notify(errorText(error), true))
      .finally(() => setBusy(false));
  };
  if (!rows.length) return <p className="muted">{t('No attempts yet.')}</p>;
  return (
    <div className="table claims-table">
      <div className="table-row head">
        <span>{t('program')}</span>
        <span>{t('report')}</span>
        <span>{t('on chain')}</span>
        <span />
      </div>
      {rows.map(({ claim, bounty, status }) => (
        <div key={claim.submission} className="table-row">
          <a href={'#/programs/' + claim.bounty}>#{claim.bounty}</a>
          <code title={claim.commitment.report_hash}>
            {claim.commitment.report_hash.slice(0, 12)}…
          </code>
          <span className={'tag' + (bounty?.winner === account ? ' paid' : '')}>{t(status)}</span>
          {bounty?.winner === account && bounty?.state === 'Retryable' ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => retry(claim.bounty)}
            >
              {t('Retry payout')}
            </button>
          ) : status === 'Waiting for the verdict' ? (
            <a href={'#/programs/' + claim.bounty}>{t('Resubmit →')}</a>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

function MyAttempts() {
  const { chain, account, connect, notify } = useEnv(),
    t = useT();
  const data = useAsync(
    () => (account ? loadMine(chain, account) : Promise.resolve(undefined)),
    [account],
  );
  const totals: [string, string][] = data.value
    ? [
        [near(earned(data.value.wins)), 'paid to you'],
        [String(data.value.wins.length), 'wins'],
        [
          String(
            data.value.attempts.filter((row) => row.status === 'Waiting for the verdict').length,
          ),
          'waiting for a verdict',
        ],
        [String(data.value.attempts.length), 'claims'],
      ]
    : [];
  return (
    <div className="wrap">
      <div className="hunt-head">
        <div className="eyebrow">{t('MY CLAIMS')}</div>
        <h1>{t('Your claims.')}</h1>
        <p className="lead">
          {account ? <Account name={account} /> : t('Read from the contract, not from us.')}
        </p>
      </div>
      {!account && (
        <div className="card">
          <p>{t('Your attempts and rewards will appear here after you connect a wallet.')}</p>
          <button
            type="button"
            className="button"
            onClick={() => connect().catch((e) => notify(errorText(e), true))}
          >
            {t('Connect wallet')}
          </button>
        </div>
      )}
      {data.loading && account && <p className="muted">{t('Loading chain data…')}</p>}
      {data.error && <p className="error-text">{t(data.error)}</p>}
      {data.value && (
        <>
          <section className="stats">
            {totals.map(([value, label]) => (
              <div key={label} className="stat">
                <strong>{value}</strong>
                <span>{t(label)}</span>
              </div>
            ))}
          </section>
          <div className="mine">
            <Claims rows={data.value.attempts} reload={data.reload} />
          </div>
        </>
      )}
    </div>
  );
}

function Toast({ note, close }: { note?: Note; close(): void }) {
  const t = useT();
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(close, note.error ? 10000 : 5000);
    return () => clearTimeout(timer);
  }, [note]);
  if (!note) return null;
  return (
    <div className={'toast' + (note.error ? ' error' : '')} role="status" aria-live="polite">
      <span>{t(note.text)}</span>
      <button type="button" className="chip" onClick={close} aria-label={t('Close')}>
        ✕
      </button>
    </div>
  );
}

function Footer() {
  const { chain, meta } = useEnv(),
    t = useT();
  const external = { target: '_blank', rel: 'noopener noreferrer' };
  return (
    <footer className="footer wrap">
      <a href={chain.accountUrl(meta.contract)} {...external}>
        {t('Inspect the contract ↗')}
      </a>
      <a href="#/docs">{t('Docs')}</a>
      <a href="#/docs/verify">{t('How to check a verdict')}</a>
      <a href={repository} {...external}>
        {t('Read the code ↗')}
      </a>
      <a className="hack" href="#/programs">
        {t('Start hunting →')}
      </a>
      <a href="#/projects/new">{t('Launch a bounty →')}</a>
      <span className="pixel">PWNBOUNTY</span>
    </footer>
  );
}

function Shell({ meta }: { meta: Meta }) {
  const { route, id } = useRoute();
  const hunting = route === 'programs' || route === 'program';
  const [account, setAccount] = useState<string>();
  const [note, setNote] = useState<Note>();
  const [team, setTeam] = useState<TeamDraft>({ hash: '', context: '' });
  const services = useMemo(() => {
    const chain = new Chain(meta.network, meta.contract);
    return {
      chain,
      wallet: new HunterWallet(meta.network, meta.contract, meta.allow_mainnet_writes === true),
      worker: new ChainVerifier(meta, chain),
    };
  }, [meta]);
  useEffect(() => {
    services.wallet.account().then(setAccount, () => undefined);
  }, [services]);
  const env: Env = {
    meta,
    ...services,
    account,
    team,
    setTeam,
    notify: (text, error = false) => setNote({ text, error }),
    connect: async () => {
      const connected = await services.wallet.connect();
      setAccount(connected);
      return connected;
    },
    disconnect: async () => {
      await services.wallet.disconnect();
      setAccount(undefined);
    },
  };
  return (
    <EnvContext.Provider value={env}>
      <Header route={route} />
      <main data-side={sideOf(route)?.icon}>
        {route === 'home' && <Landing />}
        <div hidden={!hunting}>
          <Hunt visible={hunting} program={route === 'program' ? id : undefined} />
        </div>
        {route === 'me' && <MyAttempts />}
        {route === 'projects' && <Projects />}
        {route === 'mine' && <MyProgramsPage />}
        {route === 'launch' && <Launch />}
        {route === 'docs' && <Docs />}
        {route === 'incidents' && <Incidents />}
      </main>
      <Footer />
      <Toast note={note} close={() => setNote(undefined)} />
    </EnvContext.Provider>
  );
}

function App() {
  const [meta, setMeta] = useState<Meta>();
  const [error, setError] = useState<string>();
  const t = useT();
  useEffect(() => {
    loadMeta().then(setMeta, (e) => setError(errorText(e)));
  }, []);
  if (meta) return <Shell meta={meta} />;
  return (
    <main className="splash">
      <Brand />
      <p className={error ? 'error-text' : 'muted'}>
        {error ? t(error) : t('Loading verification mode…')}
      </p>
      {error && <a href={`?network=testnet${location.hash}`}>{t('Open testnet →')}</a>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
