import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { digest, openDisclosure } from './crypto.js';
import { HunterWallet } from './wallet.js';
import { Chain, near, type Bounty, type Entry } from './chain.js';
import {
  context,
  EnvContext,
  errorText,
  loadMeta,
  useAsync,
  useEnv,
  Worker,
  type Env,
  type Meta,
  type Note,
  type TeamDraft,
} from './env.js';
import type { ChainReader, HunterClaim, VerifierApi } from './ports.js';
import { Icon, type IconName } from './icons.js';
import { LangProvider, useLang, useT } from './i18n.js';
import { Hunt } from './hunt.js';
import { Coverage, Launch } from './checks.js';
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
        <h1>{t('My claims')}</h1>
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

async function decrypt(
  worker: VerifierApi,
  draft: TeamDraft,
  file: File | undefined,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(draft.hash)) throw new Error('Invalid disclosure hash');
  if (!file || file.size > 4096) throw new Error('Choose the team PKCS8 DER private key');
  const c = context(JSON.parse(draft.context));
  const ciphertext = await worker.disclosure(draft.hash);
  if ((await digest(ciphertext)) !== draft.hash) throw new Error('Ciphertext hash mismatch');
  try {
    return await openDisclosure(ciphertext, await file.arrayBuffer(), c);
  } catch {
    throw new Error('Decryption failed: check the key, the context and X25519 support');
  }
}

function TeamDecryptPanel() {
  const { worker, team, setTeam, notify } = useEnv(),
    t = useT();
  const [plain, setPlain] = useState<string>();
  const key = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const clear = () => setPlain(undefined);
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    decrypt(worker, { hash: team.hash.trim(), context: team.context }, key.current?.files?.[0])
      .then(
        (text) => {
          setPlain(text);
          notify('Disclosure decrypted locally.');
        },
        (error) => notify(errorText(error), true),
      )
      .finally(() => {
        if (key.current) key.current.value = '';
      });
  };
  return (
    <div id="mine" className="wrap team">
      <details open>
        <summary>{t('For the project team')}</summary>
        <p>{t('Upload your team key to decrypt locally. The key never leaves this browser.')}</p>
        <form onSubmit={submit}>
          <label className="field">
            {t('Ciphertext hash')}
            <input
              required
              pattern="[a-f0-9]{64}"
              autoComplete="off"
              value={team.hash}
              onChange={(e) => setTeam({ ...team, hash: e.target.value })}
            />
          </label>
          <label className="field">
            {t('Context - JSON with network, contract, bounty, hunter, submission')}
            <textarea
              required
              rows={4}
              value={team.context}
              onChange={(e) => setTeam({ ...team, context: e.target.value })}
            />
          </label>
          <label className="field">
            {t('Team X25519 private key (PKCS8 DER)')}
            <input ref={key} required type="file" />
          </label>
          <button type="submit" className="button">
            {t('Fetch ciphertext and decrypt locally')}
          </button>
        </form>
        {plain !== undefined && (
          <>
            <pre>{plain}</pre>
            <button type="button" className="chip" onClick={() => setPlain(undefined)}>
              {t('Clear disclosure')}
            </button>
          </>
        )}
      </details>
    </div>
  );
}

function Operator({ token, setToken }: { token: string; setToken(value: string): void }) {
  const t = useT();
  return (
    <details className="wrap operator">
      <summary>{t('Operator token')}</summary>
      <input
        type="password"
        autoComplete="off"
        value={token}
        placeholder={t("Kept only in this tab's memory")}
        onChange={(e) => setToken(e.target.value)}
      />
    </details>
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
      <a href={repository} {...external}>
        {t('Read the code ↗')}
      </a>
      <a href="#/programs">{t('Start hunting →')}</a>
      <a href="#/projects/new">{t('Launch a bounty →')}</a>
    </footer>
  );
}

function Shell({ meta }: { meta: Meta }) {
  const { route, id } = useRoute();
  const hunting = route === 'programs' || route === 'program';
  const token = useRef('');
  const [tokenValue, setTokenValue] = useState('');
  const [askToken, setAskToken] = useState(meta.public_ingress === false);
  const [account, setAccount] = useState<string>();
  const [note, setNote] = useState<Note>();
  const [team, setTeam] = useState<TeamDraft>({ hash: '', context: '' });
  const services = useMemo(
    () => ({
      chain: new Chain(meta.network, meta.contract),
      wallet: new HunterWallet(meta.network, meta.contract, meta.allow_mainnet_writes === true),
      worker: new Worker(
        meta,
        () => token.current,
        () => setAskToken(true),
      ),
    }),
    [meta],
  );
  const setToken = (value: string) => {
    token.current = value;
    setTokenValue(value);
  };
  useEffect(() => {
    services.wallet.account().then(setAccount, () => undefined);
    const clear = () => setToken('');
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
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
      {askToken && <Operator token={tokenValue} setToken={setToken} />}
      <main>
        {route === 'home' && <Landing />}
        <div hidden={!hunting}>
          <Hunt visible={hunting} program={route === 'program' ? id : undefined} />
        </div>
        {route === 'me' && <MyAttempts />}
        {route === 'projects' && (
          <>
            <Coverage />
            <TeamDecryptPanel />
          </>
        )}
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
