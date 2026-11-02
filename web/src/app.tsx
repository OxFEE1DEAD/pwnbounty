import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { digest, openDisclosure } from './crypto.js';
import { HunterWallet } from './wallet.js';
import {
  Chain, history, near, readLimited, type Attempt, type Bounty, type Entry,
} from './chain.js';
import type { ChainCommitment } from './settlement.js';
import {
  context, EnvContext, errorText, loadMeta, useAsync, useEnv, Worker, type Env, type Meta,
  type Note, type TeamDraft,
} from './env.js';
import { LangProvider, useLang, useT } from './i18n.js';
import { Hunt } from './hunt.js';
import { Account, Landing, repository } from './landing.js';
import '../style.css';

const routes = ['home', 'hunt', 'me', 'team'] as const;
const anchors = ['how', 'evidence'];
type Route = typeof routes[number];
type AttemptStatus = 'not-committed' | 'pending' | 'no-violation' | 'beaten' | 'paid'
  | 'retryable' | 'payout-pending' | 'unknown';

const attemptLabels:Record<AttemptStatus,string> = {
  'not-committed': 'Not on NEAR yet',
  pending: 'Waiting for the verdict',
  'no-violation': 'No violation, no reward',
  beaten: 'Valid, but another hunter was first',
  paid: 'Paid',
  retryable: 'Payout failed - retry it under Rewards',
  'payout-pending': 'Payout in progress',
  unknown: 'Could not check',
};
const stateLabels:Record<string,string> = {
  Paid: 'Paid', Pending: 'Payout in progress', Retryable: 'Payout failed',
};

function readHash():{route:Route;anchor?:string} {
  const name = location.hash.replace(/^#\/?/, '');
  if (anchors.includes(name)) return {route: 'home', anchor: name};
  return {route: (routes as readonly string[]).includes(name) ? name as Route : 'home'};
}

function useRoute():Route {
  const [route, setRoute] = useState(() => readHash().route);
  useEffect(() => {
    const change = () => {
      const {route: next, anchor} = readHash();
      setRoute(next);
      window.requestAnimationFrame(() => {
        if (anchor) document.getElementById(anchor)?.scrollIntoView({behavior: 'smooth'});
        else window.scrollTo(0, 0);
      });
    };
    change();
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}

function Header({route}:{route:Route}) {
  const {meta, account, connect, notify} = useEnv(), t = useT();
  const {lang, toggle} = useLang();
  const nav:[string,string,boolean][] = [
    ['#/how', 'How it works', false], ['#/evidence', 'Live evidence', false],
    ['#/me', 'My attempts', route === 'me'], ['#/hunt', 'Hunt a bounty', route === 'hunt'],
  ];
  const wallet = () => {
    if (account) location.hash = '#/me';
    else connect().catch(error => notify(errorText(error), true));
  };
  return (
    <header className="top wrap">
      <button type="button" className="lang" onClick={toggle} aria-label={t('Switch language')}>
        {lang === 'en' ? 'EN / RU' : 'RU / EN'}
      </button>
      <a className="brand" href="#/">SEALED <mark>BOUNTY</mark></a>
      <nav aria-label={t('Main navigation')}>
        {nav.map(([href, label, current]) => (
          <a key={href} href={href} className={current ? 'current' : ''}>{t(label)}</a>
        ))}
      </nav>
      <span className="badge">{meta.network}</span>
      <button type="button" className="button secondary wallet" onClick={wallet}>
        {account ?? t('Connect wallet')}
      </button>
    </header>
  );
}

async function attemptStatus(chain:Chain,attempt:Attempt,bounties:Map<string,Bounty>)
  :Promise<AttemptStatus> {
  const {account: hunter, bounty: id, submission} = attempt;
  const {value: claim} = await chain.view<ChainCommitment>(
    'get_commitment', {bounty: id, hunter, submission});
  if (!claim) return 'not-committed';
  if (!claim.settled) return 'pending';
  if (!claim.verdict?.valid) return 'no-violation';
  const bounty = bounties.get(id);
  if (bounty?.winner !== hunter) return 'beaten';
  if (bounty.state === 'Paid') return 'paid';
  return bounty.state === 'Retryable' ? 'retryable' : 'payout-pending';
}

async function loadMine(chain:Chain,account:string) {
  const {entries} = await chain.allBounties();
  const bounties = new Map(entries.map(entry => [entry.id, entry.bounty]));
  const wins = entries.filter(entry => entry.bounty.winner === account);
  const attempts = await Promise.all(history.list(account).map(async attempt => ({
    attempt,
    status: await attemptStatus(chain, attempt, bounties).catch(() => 'unknown' as const),
  })));
  return {wins, attempts};
}

function Wins({wins, reload}:{wins:Entry[];reload():void}) {
  const {wallet, account, notify} = useEnv(), t = useT();
  const [busy, setBusy] = useState(false);
  const retry = (id:string) => {
    setBusy(true);
    wallet.retryPayment(id, account!).then(reload, error => notify(errorText(error), true))
      .finally(() => setBusy(false));
  };
  if (!wins.length) return <p className="muted">{t('No rewards yet.')}</p>;
  return <>
    {wins.map(({id, bounty}) => (
      <div key={id} className="payout-row">
        <span>{t('Program #')}{id}</span>
        <strong>{near(bounty.reward)}</strong>
        <span className="tag">{t(stateLabels[bounty.state] ?? bounty.state)}</span>
        {bounty.state === 'Retryable' && <button type="button" className="button"
          disabled={busy} onClick={() => retry(id)}>{t('Retry payout')}</button>}
      </div>
    ))}
  </>;
}

function Attempts({rows}:{rows:{attempt:Attempt;status:AttemptStatus}[]}) {
  const t = useT();
  if (!rows.length) {
    return <p className="muted">{t('No sealed attempts from this browser yet.')}</p>;
  }
  return <>
    {rows.map(({attempt, status}) => (
      <div key={attempt.submission} className="payout-row">
        <span>{t('Program #')}{attempt.bounty}</span>
        <span className="muted">{new Date(attempt.at).toLocaleString()}</span>
        <code title={attempt.report_hash}>{attempt.report_hash.slice(0, 12)}…</code>
        <span className={'tag ' + status}>{t(attemptLabels[status])}</span>
      </div>
    ))}
  </>;
}

function MyAttempts() {
  const {chain, account, connect, notify} = useEnv(), t = useT();
  const data = useAsync(
    () => account ? loadMine(chain, account) : Promise.resolve(undefined), [account]);
  return (
    <div className="wrap">
      <div className="hunt-head">
        <div className="eyebrow">MY ATTEMPTS</div>
        <h1>{t('My attempts')}</h1>
        {account && <p className="lead"><Account name={account}/></p>}
      </div>
      {!account && <div className="card">
        <p>{t('Your sealed attempts will appear here after you connect a wallet.')}</p>
        <button type="button" className="button"
          onClick={() => connect().catch(e => notify(errorText(e), true))}>
          {t('Connect wallet')}
        </button>
      </div>}
      {data.loading && account && <p className="muted">{t('Loading chain data…')}</p>}
      {data.error && <p className="error-text">{t(data.error)}</p>}
      {data.value && <div className="mine">
        <section className="card">
          <div className="kicker">{t('REWARDS')}</div>
          <Wins wins={data.value.wins} reload={data.reload}/>
        </section>
        <section className="card">
          <div className="kicker">{t('ATTEMPTS FROM THIS BROWSER')}</div>
          <Attempts rows={data.value.attempts}/>
        </section>
      </div>}
    </div>
  );
}

async function decrypt(worker:Worker,draft:TeamDraft,file:File | undefined):Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(draft.hash)) throw new Error('Invalid disclosure hash');
  if (!file || file.size > 4096) throw new Error('Choose the team PKCS8 DER private key');
  const c = context(JSON.parse(draft.context));
  const response = await worker.fetch('/v1/disclosures/' + draft.hash, true);
  const ciphertext = await readLimited(response, 1_048_576);
  if (await digest(ciphertext) !== draft.hash) throw new Error('Ciphertext hash mismatch');
  try {
    return await openDisclosure(ciphertext, await file.arrayBuffer(), c);
  } catch {
    throw new Error('Decryption failed: check the key, the context and X25519 support');
  }
}

function TeamDecryptPanel() {
  const {worker, team, setTeam, notify} = useEnv(), t = useT();
  const [plain, setPlain] = useState<string>();
  const key = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const clear = () => setPlain(undefined);
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);
  const submit = (event:FormEvent) => {
    event.preventDefault();
    decrypt(worker, {hash: team.hash.trim(), context: team.context}, key.current?.files?.[0])
      .then(text => {
        setPlain(text);
        notify('Disclosure decrypted locally.');
      }, error => notify(errorText(error), true))
      .finally(() => {if (key.current) key.current.value = '';});
  };
  return (
    <div className="wrap team">
      <details open>
        <summary>{t('For the project team')}</summary>
        <p>{t('Upload your team key to decrypt locally. The key never leaves this browser.')}</p>
        <form onSubmit={submit}>
          <label className="field">
            {t('Ciphertext hash')}
            <input required pattern="[a-f0-9]{64}" autoComplete="off" value={team.hash}
              onChange={e => setTeam({...team, hash: e.target.value})}/>
          </label>
          <label className="field">
            {t('Context - JSON with network, contract, bounty, hunter, submission')}
            <textarea required rows={4} value={team.context}
              onChange={e => setTeam({...team, context: e.target.value})}/>
          </label>
          <label className="field">
            {t('Team X25519 private key (PKCS8 DER)')}
            <input ref={key} required type="file"/>
          </label>
          <button type="submit" className="button">
            {t('Fetch ciphertext and decrypt locally')}
          </button>
        </form>
        {plain !== undefined && <>
          <pre>{plain}</pre>
          <button type="button" className="chip" onClick={() => setPlain(undefined)}>
            {t('Clear disclosure')}
          </button>
        </>}
      </details>
    </div>
  );
}

function Operator({token, setToken}:{token:string;setToken(value:string):void}) {
  const t = useT();
  return (
    <details className="wrap operator">
      <summary>{t('Operator token')}</summary>
      <input type="password" autoComplete="off" value={token}
        placeholder={t('Kept only in this tab\'s memory')}
        onChange={e => setToken(e.target.value)}/>
    </details>
  );
}

function Toast({note, close}:{note?:Note;close():void}) {
  const t = useT();
  if (!note) return null;
  return (
    <div className={'toast' + (note.error ? ' error' : '')} role="status" aria-live="polite">
      <span>{t(note.text)}</span>
      <button type="button" className="chip" onClick={close} aria-label={t('Close')}>✕</button>
    </div>
  );
}

function Footer() {
  const {chain, meta} = useEnv(), t = useT();
  const external = {target: '_blank', rel: 'noopener noreferrer'};
  return (
    <footer className="footer wrap">
      <a href={chain.accountUrl(meta.contract)} {...external}>{t('Inspect the contract ↗')}</a>
      <a href={repository} {...external}>{t('Read the code ↗')}</a>
      <a href="#/hunt">{t('Start hunting →')}</a>
      <a href="#/team">{t('For the project team')}</a>
    </footer>
  );
}

function Shell({meta}:{meta:Meta}) {
  const route = useRoute();
  const token = useRef('');
  const [tokenValue, setTokenValue] = useState('');
  const [askToken, setAskToken] = useState(meta.public_ingress === false);
  const [account, setAccount] = useState<string>();
  const [note, setNote] = useState<Note>();
  const [team, setTeam] = useState<TeamDraft>({hash: '', context: ''});
  const services = useMemo(() => ({
    chain: new Chain(meta.network, meta.contract),
    wallet: new HunterWallet(meta.network, meta.contract, meta.allow_mainnet_writes === true),
    worker: new Worker(meta, () => token.current, () => setAskToken(true)),
  }), [meta]);
  const setToken = (value:string) => {
    token.current = value;
    setTokenValue(value);
  };
  useEffect(() => {
    services.wallet.account().then(setAccount, () => undefined);
    const clear = () => setToken('');
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, [services]);
  const env:Env = {
    meta, ...services, account, team, setTeam,
    notify: (text, error = false) => setNote({text, error}),
    connect: async () => setAccount(await services.wallet.connect()),
  };
  return (
    <EnvContext.Provider value={env}>
      <Header route={route}/>
      {askToken && <Operator token={tokenValue} setToken={setToken}/>}
      <main>
        {route === 'home' && <Landing/>}
        <div hidden={route !== 'hunt'}><Hunt visible={route === 'hunt'}/></div>
        {route === 'me' && <MyAttempts/>}
        {route === 'team' && <TeamDecryptPanel/>}
      </main>
      <Footer/>
      <Toast note={note} close={() => setNote(undefined)}/>
    </EnvContext.Provider>
  );
}

function App() {
  const [meta, setMeta] = useState<Meta>();
  const [error, setError] = useState<string>();
  const t = useT();
  useEffect(() => {loadMeta().then(setMeta, e => setError(errorText(e)));}, []);
  if (meta) return <Shell meta={meta}/>;
  return (
    <main className="splash">
      <a className="brand" href="#/">SEALED <mark>BOUNTY</mark></a>
      <p className={error ? 'error-text' : 'muted'}>
        {error ? t(error) : t('Loading verification mode…')}
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<LangProvider><App/></LangProvider>);
