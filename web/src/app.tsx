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
import { LangProvider, useLang, useT } from './i18n.js';
import { Hunt } from './hunt.js';
import { Launch } from './launch.js';
import { Projects } from './projects.js';
import { Account, Landing, repository } from './landing.js';
import '../style.css';

type Route = 'home' | 'programs' | 'program' | 'me' | 'projects' | 'launch';
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
  path: string;
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
    path: 'find a program → send a sealed attack → get paid',
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
    path: 'describe → test run → fund → read reports',
    links: [
      ['#/projects', 'Overview', ['projects']],
      ['#/projects/mine', 'My programs', []],
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
    return sub === 'new' ? { route: 'launch' } : { route: 'projects', anchor: sub };
  if (name === 'me') return { route: 'me' };
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
  const { lang, toggle } = useLang();
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
        <span className="badge">{meta.network}</span>
        <button type="button" className="lang" onClick={toggle} aria-label={t('Switch language')}>
          {lang === 'en' ? 'EN / RU' : 'RU / EN'}
        </button>
        <button type="button" className="button wallet" onClick={wallet}>
          {account ?? t('Connect wallet')}
        </button>
        {account && (
          <button
            type="button"
            className="chip"
            onClick={() => disconnect().catch((error) => notify(errorText(error), true))}
          >
            {t('Log out')}
          </button>
        )}
      </header>
      {side && (
        <nav className="subnav wrap" aria-label={t(side.label)}>
          <span className="pixel">{t(side.title)}</span>
          {side.links.map(([href, label, routes]) => (
            <a key={href} href={href} className={routes.includes(route) ? 'current' : ''}>
              {t(label)}
            </a>
          ))}
          <span className="route-line">{t(side.path)}</span>
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
      .map((claim) => ({ claim, status: claimStatus(claim, bounties.get(claim.bounty), account) }))
      .reverse(),
  };
}

const earned = (wins: Entry[]) =>
  wins
    .filter((entry) => entry.bounty.state === 'Paid')
    .reduce((sum, entry) => sum + BigInt(entry.bounty.reward), 0n);

function Wins({ wins, reload }: { wins: Entry[]; reload(): void }) {
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
  if (!wins.length) return <p className="muted">{t('No rewards yet.')}</p>;
  return (
    <>
      {wins.map(({ id, bounty }) => (
        <div key={id} className="payout-row">
          <span>
            {t('Program #')}
            {id}
          </span>
          <strong>{near(bounty.reward)}</strong>
          <span className="tag">{t(stateLabels[bounty.state] ?? bounty.state)}</span>
          {bounty.state === 'Retryable' && (
            <button type="button" className="button" disabled={busy} onClick={() => retry(id)}>
              {t('Retry payout')}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function Attempts({ rows }: { rows: { claim: HunterClaim; status: string }[] }) {
  const t = useT();
  if (!rows.length) return <p className="muted">{t('No attempts yet.')}</p>;
  return (
    <>
      {rows.map(({ claim, status }) => (
        <div key={claim.submission} className="payout-row">
          <a href={'#/programs/' + claim.bounty}>
            {t('Program #')}
            {claim.bounty}
          </a>
          <code title={claim.commitment.report_hash}>
            {claim.commitment.report_hash.slice(0, 12)}…
          </code>
          <span className="tag">{t(status)}</span>
          {status === 'Waiting for the verdict' && (
            <a href={'#/programs/' + claim.bounty}>{t('Resubmit →')}</a>
          )}
        </div>
      ))}
    </>
  );
}

function MyAttempts() {
  const { chain, account, connect, notify } = useEnv(),
    t = useT();
  const data = useAsync(
    () => (account ? loadMine(chain, account) : Promise.resolve(undefined)),
    [account],
  );
  return (
    <div className="wrap">
      <div className="hunt-head">
        <div className="eyebrow">{t('MY CLAIMS')}</div>
        <h1>{t('Every claim, read from the contract.')}</h1>
        {account && (
          <p className="lead">
            <Account name={account} />
          </p>
        )}
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
        <section className="stats">
          <div className="stat">
            <strong>{near(earned(data.value.wins))}</strong>
            <span>{t('earned, paid only')}</span>
          </div>
          <div className="stat">
            <strong>{data.value.wins.length}</strong>
            <span>{t('wins')}</span>
          </div>
        </section>
      )}
      {data.value && (
        <div className="mine">
          <section className="card">
            <div className="kicker">{t('REWARDS')}</div>
            <Wins wins={data.value.wins} reload={data.reload} />
          </section>
          <section className="card">
            <div className="kicker">{t('ATTEMPTS')}</div>
            <Attempts rows={data.value.attempts} />
          </section>
        </div>
      )}
    </div>
  );
}

function Toast({ note, close }: { note?: Note; close(): void }) {
  const t = useT();
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
      <span title={meta.signing_public_key}>
        {t('Verifier key')} {meta.signing_public_key.slice(0, 8)}…
      </span>
      <a href={repository} {...external}>
        {t('Read the code ↗')}
      </a>
      <a href="#/programs">{t('Start hunting →')}</a>
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
    connect: async () => setAccount(await services.wallet.connect()),
    disconnect: async () => {
      await services.wallet.disconnect();
      setAccount(undefined);
    },
  };
  return (
    <EnvContext.Provider value={env}>
      <Header route={route} />
      <main>
        {route === 'home' && <Landing />}
        <div hidden={!hunting}>
          <Hunt visible={hunting} program={route === 'program' ? id : undefined} />
        </div>
        {route === 'me' && <MyAttempts />}
        {route === 'projects' && <Projects />}
        {route === 'launch' && <Launch />}
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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <LangProvider>
    <App />
  </LangProvider>,
);
