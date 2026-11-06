import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { near, type Entry } from './chain.js';
import { digest, openDisclosure } from './crypto.js';
import { context, errorText, useAsync, useEnv, type TeamDraft } from './env.js';
import type { ChainReader, VerifierApi } from './ports.js';
import { useT } from './i18n.js';
import { CoverageTable } from './checks.js';

const lead =
  'Write down what a break of your contract or agent looks like. Hackers attack it, a verifier ' +
  'replays every attack, and the contract pays the first one that breaks the rule. Junk reports ' +
  'cost you nothing and need no triage.';
const steps: [string, string][] = [
  [
    '01 DESCRIBE',
    'Start from a template or upload your .wasm build. Set the starting balances and what ' +
      'counts as a break.',
  ],
  [
    '02 TEST RUN',
    'Replay your honest cases and the known attacks with one CLI command, before any money ' +
      'moves.',
  ],
  [
    '03 FUND',
    'Create the program: the reward goes to escrow and you keep your team key. The program ' +
      'appears in the hacker catalog.',
  ],
  [
    '04 READ REPORTS',
    'Decrypt the winning attack with your team key. Nobody broke it? Take the reward back ' +
      'after the deadline.',
  ],
];
const labels: Record<string, string> = {
  Paid: 'Paid',
  Pending: 'Payout in progress',
  Retryable: 'Payout failed',
  Refunding: 'Refunding',
  Closed: 'Closed',
};

function standing(entry: Entry, height: bigint): { label: string; tag: string; refund: boolean } {
  const { state, expires, settle_until } = entry.bounty;
  if (state !== 'Available')
    return { label: labels[state] ?? state, tag: state.toLowerCase(), refund: false };
  if (height < BigInt(expires)) return { label: 'Open', tag: 'open', refund: false };
  if (height <= BigInt(settle_until))
    return { label: 'Settling claims', tag: 'pending', refund: false };
  return { label: 'No winner', tag: 'closed', refund: true };
}

async function owned(chain: ChainReader, account: string) {
  const { entries, height } = await chain.allBounties();
  return { height, mine: entries.filter((entry) => entry.bounty.owner === account).reverse() };
}

async function winningReport(chain: ChainReader, entry: Entry): Promise<TeamDraft> {
  const claims = await chain.hunterClaims(entry.bounty.winner!, 0, 50);
  const verdict = claims.find(
    (claim) => claim.bounty === entry.id && claim.commitment.verdict?.valid,
  )?.commitment.verdict;
  if (!verdict) {
    throw new Error(
      'The winning claim is not in the claim index. Paste the hash and context below.',
    );
  }
  return { hash: verdict.disclosure_hash, context: JSON.stringify(context(verdict), null, 2) };
}

async function decrypt(
  worker: VerifierApi,
  draft: TeamDraft,
  file: File | undefined,
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(draft.hash)) throw new Error('Invalid disclosure hash');
  if (!file || file.size > 4096) throw new Error('Choose the team PKCS8 DER private key');
  const c = context(JSON.parse(draft.context));
  const ciphertext = await worker.disclosure(c.bounty, c.hunter, c.submission);
  if ((await digest(ciphertext)) !== draft.hash) throw new Error('Ciphertext hash mismatch');
  try {
    return await openDisclosure(ciphertext, await file.arrayBuffer(), c);
  } catch {
    throw new Error('Decryption failed: check the key, the context and X25519 support');
  }
}

function MyPrograms() {
  const { chain, wallet, account, connect, notify, setTeam } = useEnv(),
    t = useT();
  const data = useAsync(
    () => (account ? owned(chain, account) : Promise.resolve(undefined)),
    [account],
  );
  const [busy, setBusy] = useState(false);
  const act = (action: () => Promise<void>) => {
    setBusy(true);
    action()
      .catch((error) => notify(errorText(error), true))
      .finally(() => setBusy(false));
  };
  const withdraw = (id: string) =>
    act(async () => {
      await wallet.withdraw(id);
      notify('Withdrawal sent. The reward returns to your wallet.');
      data.reload();
    });
  const report = (entry: Entry) =>
    act(async () => {
      setTeam(await winningReport(chain, entry));
      document.getElementById('team')?.scrollIntoView({ behavior: 'smooth' });
    });
  return (
    <section id="mine">
      {!account && (
        <button
          type="button"
          className="button"
          onClick={() => connect().catch((error) => notify(errorText(error), true))}
        >
          {t('Connect wallet')}
        </button>
      )}
      {data.loading && account && <p className="muted">{t('Loading chain data…')}</p>}
      {data.error && <p className="error-text">{t(data.error)}</p>}
      {data.value && !data.value.mine.length && (
        <p className="muted">
          {t('No programs from this account yet.')}{' '}
          <a href="#/projects/new">{t('Launch a program →')}</a>
        </p>
      )}
      {!!data.value?.mine.length && (
        <div className="table mine-table">
          <div className="table-row head">
            <span>{t('program')}</span>
            <span>{t('state')}</span>
            <span>{t('reward')}</span>
            <span />
          </div>
          {data.value.mine.map((entry) => {
            const now = standing(entry, data.value!.height);
            return (
              <div key={entry.id} className="table-row">
                <a href={'#/programs/' + entry.id}>#{entry.id}</a>
                <span className={'tag ' + now.tag}>{t(now.label)}</span>
                <strong>{near(entry.bounty.reward)}</strong>
                {now.refund ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => withdraw(entry.id)}
                  >
                    {t('Withdraw {amount}', { amount: near(entry.bounty.reward) })}
                  </button>
                ) : entry.bounty.state === 'Paid' ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => report(entry)}
                  >
                    {t('Decrypt report')}
                  </button>
                ) : (
                  <a className="button secondary" href={'#/programs/' + entry.id}>
                    {t('Open program')}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface Operation {
  amount: string;
  recipient: string;
  executed: boolean;
}

function Disclosure({ text }: { text: string }) {
  const t = useT();
  let report: { attack?: string; trace?: { balance?: string; operations?: Operation[] } } = {};
  try {
    report = JSON.parse(text);
  } catch {}
  return (
    <>
      {report.attack !== undefined && (
        <>
          <h3>{t('Winning attack')}</h3>
          <pre>{report.attack}</pre>
        </>
      )}
      {report.trace?.operations?.map((op, i) => (
        <p key={i}>
          {t('Agent sent {amount} to {recipient}', { amount: op.amount, recipient: op.recipient })}{' '}
          · <strong>{op.executed ? t('executed') : t('blocked')}</strong>
        </p>
      ))}
      {report.trace?.balance && (
        <p className="muted">
          {t('Test balance after the run: {balance}', { balance: report.trace.balance })}
        </p>
      )}
      <details className="raw">
        <summary>{t('Full report')}</summary>
        <pre>{text}</pre>
      </details>
    </>
  );
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
    <section id="team" className="card team">
      <div className="kicker">{t('TEAM KEY')}</div>
      <h3>{t('Decrypt a report')}</h3>
      <p>
        {t(
          'Decrypting happens in this browser. Pick the team key file you saved at launch; it never leaves this page.',
        )}
      </p>
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
          <Disclosure text={plain} />
          <button type="button" className="chip" onClick={() => setPlain(undefined)}>
            {t('Clear disclosure')}
          </button>
        </>
      )}
    </section>
  );
}

export function Projects() {
  const t = useT();
  return (
    <div className="wrap">
      <section className="hunt-head">
        <div className="eyebrow">{t('FOR PROJECTS')}</div>
        <h1>{t('Pay only for a proved break.')}</h1>
        <p className="lead">{t(lead)}</p>
        <div className="row">
          <a className="button" href="#/projects/new">
            {t('Launch a program →')}
          </a>
        </div>
      </section>
      <ol className="wizard-steps" style={{ '--n': steps.length } as CSSProperties}>
        {steps.map(([tag, text]) => (
          <li key={tag}>
            <div className="now">
              <b>{t(tag)}</b>
              <span>{t(text)}</span>
            </div>
          </li>
        ))}
      </ol>
      <section className="band">
        <div className="section-head">
          <div>
            <div className="eyebrow">{t('TESTED TODAY')}</div>
            <h2>{t('Known attacks, real results.')}</h2>
          </div>
          <a href="#/docs/coverage">{t('Every attack, case by case →')}</a>
        </div>
        <CoverageTable />
      </section>
    </div>
  );
}

export function MyProgramsPage() {
  const t = useT();
  return (
    <div className="wrap">
      <section className="hunt-head">
        <div className="eyebrow">{t('MY PROGRAMS')}</div>
        <h1>{t('Your programs.')}</h1>
        <p className="lead">{t('Read from the contract. Reports open only with your team key.')}</p>
        <div className="row">
          <a className="button secondary" href="#/projects/new">
            {t('New program')}
          </a>
        </div>
      </section>
      <MyPrograms />
      <TeamDecryptPanel />
    </div>
  );
}
