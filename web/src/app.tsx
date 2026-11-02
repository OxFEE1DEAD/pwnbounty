import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { digest, openDisclosure } from './crypto.js';
import { HunterWallet } from './wallet.js';
import { Chain, near, readLimited, type Bounty, type Entry } from './chain.js';
import type { ChainCommitment } from './settlement.js';
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
import { LangProvider, useLang, useT } from './i18n.js';
import { Hunt } from './hunt.js';
import { Coverage, Launch } from './checks.js';
import { Account, Landing, repository } from './landing.js';
import '../style.css';

const routes = ['home', 'hunt', 'me', 'team', 'coverage', 'launch'] as const;
const anchors = ['how', 'evidence'];
type Route = (typeof routes)[number];
const stateLabels: Record<string, string> = {
  Paid: 'Paid',
  Pending: 'Payout in progress',
  Retryable: 'Payout failed',
};

function readHash(): { route: Route; param?: string; anchor?: string } {
  const [name = '', param] = location.hash.replace(/^#\/?/, '').split('/');
  if (anchors.includes(name)) return { route: 'home', anchor: name };
  if (!(routes as readonly string[]).includes(name)) return { route: 'home' };
  return { route: name as Route, param };
}

function useRoute(): { route: Route; param?: string } {
  const [route, setRoute] = useState(() => readHash());
  useEffect(() => {
    const change = () => {
      const { route: next, param, anchor } = readHash();
      setRoute({ route: next, param });
      window.requestAnimationFrame(() => {
        if (anchor) document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth' });
        else window.scrollTo(0, 0);
      });
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}

function Header({ route }: { route: Route }) {
  const { meta, account, connect, disconnect, notify } = useEnv(),
    t = useT();
  const { lang, toggle } = useLang();
  const nav: [string, string, boolean][] = [
    ['#/how', 'How it works', false],
    ['#/coverage', 'Coverage', route === 'coverage'],
    ['#/launch', 'For projects', route === 'launch'],
    ['#/me', 'My attempts', route === 'me'],
    ['#/hunt', 'Hunt a bounty', route === 'hunt'],
  ];
  const wallet = () => {
    if (account) location.hash = '#/me';
    else connect().catch((error) => notify(errorText(error), true));
  };
  return (
    <header className="top wrap">
      <button type="button" className="lang" onClick={toggle} aria-label={t('Switch language')}>
        {lang === 'en' ? 'EN / RU' : 'RU / EN'}
      </button>
      <a className="brand" href="#/">
        SEALED <mark>BOUNTY</mark>
      </a>
      <nav aria-label={t('Main navigation')}>
        {nav.map(([href, label, current]) => (
          <a key={href} href={href} className={current ? 'current' : ''}>
            {t(label)}
          </a>
        ))}
      </nav>
      <span className="badge">{meta.network}</span>
      <button type="button" className="button secondary wallet" onClick={wallet}>
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
  );
}

interface Claim {
  bounty: string;
  submission: string;
  commitment: ChainCommitment;
}

function claimStatus({ commitment }: Claim, bounty: Bounty | undefined, hunter: string): string {
  if (!commitment.settled) return 'Waiting for the verdict';
  if (!commitment.verdict?.valid) return 'No break, no reward';
  if (bounty?.winner !== hunter) return 'Valid, but another hunter was first';
  return stateLabels[bounty.state] ?? bounty.state;
}

async function loadMine(chain: Chain, account: string) {
  const [{ entries }, { value: claims }] = await Promise.all([
    chain.allBounties(),
    chain.view<Claim[]>('get_hunter_commitments', { hunter: account, from_index: '0', limit: 50 }),
  ]);
  const bounties = new Map(entries.map((entry) => [entry.id, entry.bounty]));
  return {
    wins: entries.filter((entry) => entry.bounty.winner === account),
    attempts: (claims ?? [])
      .map((claim) => ({ ...claim, bounty: String(claim.bounty) }))
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

function Attempts({ rows }: { rows: { claim: Claim; status: string }[] }) {
  const t = useT();
  if (!rows.length) return <p className="muted">{t('No attempts yet.')}</p>;
  return (
    <>
      {rows.map(({ claim, status }) => (
        <div key={claim.submission} className="payout-row">
          <a href={'#/hunt/' + claim.bounty}>
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
        <div className="eyebrow">{t('MY ATTEMPTS')}</div>
        <h1>{t('My attempts')}</h1>
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

async function decrypt(worker: Worker, draft: TeamDraft, file: File | undefined): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(draft.hash)) throw new Error('Invalid disclosure hash');
  if (!file || file.size > 4096) throw new Error('Choose the team PKCS8 DER private key');
  const c = context(JSON.parse(draft.context));
  const response = await worker.fetch('/v1/disclosures/' + draft.hash, true);
  const ciphertext = await readLimited(response, 1_048_576);
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
    <div className="wrap team">
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
      <a href="#/hunt">{t('Start hunting →')}</a>
      <a href="#/launch">{t('Launch a bounty →')}</a>
      <a href="#/team">{t('For the project team')}</a>
    </footer>
  );
}

function Shell({ meta }: { meta: Meta }) {
  const { route, param } = useRoute();
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
        <div hidden={route !== 'hunt'}>
          <Hunt visible={route === 'hunt'} program={route === 'hunt' ? param : undefined} />
        </div>
        {route === 'me' && <MyAttempts />}
        {route === 'team' && <TeamDecryptPanel />}
        {route === 'coverage' && <Coverage />}
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
      <a className="brand" href="#/">
        SEALED <mark>BOUNTY</mark>
      </a>
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
