import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { near, overview, type Entry } from './chain.js';
import { Coverage } from './checks.js';
import { useAsync, useEnv, type Meta } from './env.js';
import { useT } from './i18n.js';
import { Icon, type IconName } from './icons.js';
import { incidents as all } from './incidents.js';

export const repository = 'https://github.com/OxFEE1DEAD/sealed-bounty';

const lead = 'No triage. A machine replays the attack, the contract pays the verdict.';
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
const incidents: [string, string, string, string, string, string, string][] = [
  [
    'Grok × Bankr',
    new URL('./showcase/bankr.png', import.meta.url).href,
    'May 2026',
    '~$150-200k',
    'An X post hid an order in Morse code. Grok decoded it and the wallet bot sent the tokens.',
    'OECD.AI',
    'https://oecd.ai/en/incidents/2026-05-04-4a73',
  ],
  [
    'Lobstar Wilde',
    '',
    'Feb 2026',
    '~$250k',
    'Asked for a 4 SOL tip, the trading agent sent its whole token stash to a stranger.',
    'Cointelegraph',
    'https://cointelegraph.com/news/openai-employee-s-ai-agent-accidentally-sent-442k-to-beggar',
  ],
  [
    'AIXBT',
    new URL('./showcase/aixbt.svg', import.meta.url).href,
    'Mar 2025',
    '55.5 ETH ~$106k',
    'An attacker got into the operator dashboard and queued two prompts. The agent paid out.',
    'AI Incident Database',
    'https://incidentdatabase.ai/cite/1003',
  ],
  [
    'Freysa',
    new URL('./showcase/freysa.png', import.meta.url).href,
    'Nov 2024',
    '~$47k',
    'A game agent was told never to release its prize pool. A player argued it into the transfer.',
    'OECD.AI',
    'https://oecd.ai/en/incidents/2024-11-29-2e31',
  ],
];
const prices: [string, string, string][] = [
  [
    'YOU PAY',
    'Only for a proved break',
    'The reward waits in escrow. No break by the deadline, it comes back.',
  ],
  [
    'YOU SKIP',
    'Triage of junk reports',
    'Every attack is replayed. A report that breaks nothing costs you nothing.',
  ],
  [
    'YOU KEEP',
    'The exploit private',
    'The report is encrypted to your team key. Only the verdict is public.',
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

type Segment = { k: 's'; ax: number; ay: number; bx: number; by: number };
type Part =
  | Segment
  | { k: 'a'; cx: number; cy: number; r: number; a0: number; a1: number }
  | { k: 'e'; cx: number; cy: number; rx: number; ry: number }
  | { k: 'd'; cx: number; cy: number; r: number };

const P = Math.PI;
const seg = (ax: number, ay: number, bx: number, by: number): Segment => ({
  k: 's',
  ax,
  ay,
  bx,
  by,
});
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): Part => ({
  k: 'a',
  cx,
  cy,
  r,
  a0,
  a1,
});
const ring = (cx: number, cy: number, rx: number, ry: number): Part => ({ k: 'e', cx, cy, rx, ry });
const dot = (cx: number, cy: number, r: number): Part => ({ k: 'd', cx, cy, r });
const box = (x0: number, y0: number, x1: number, y1: number) => [
  seg(x0, y0, x1, y0),
  seg(x1, y0, x1, y1),
  seg(x1, y1, x0, y1),
  seg(x0, y1, x0, y0),
];
const mirror = (list: Segment[]) => list.flatMap((p) => [p, { ...p, ax: -p.ax, bx: -p.bx }]);
const shift = (dy: number, list: Part[]): Part[] =>
  list.map((p) => (p.k === 's' ? { ...p, ay: p.ay + dy, by: p.by + dy } : { ...p, cy: p.cy + dy }));
const glyphs: Part[][] = [
  shift(-0.25, [
    arc(0, -3.5, 4.5, P, 2 * P),
    seg(-4.5, -3.5, -4.5, -0.5),
    seg(4.5, -3.5, 4.5, -0.5),
    ...box(-7.5, -0.5, 7.5, 8.5),
    dot(0, 3.2, 0.9),
    seg(0, 3.2, 0, 5.8),
  ]),
  shift(0.5, [
    seg(0, -8.5, 9, 7.5),
    seg(9, 7.5, -9, 7.5),
    seg(-9, 7.5, 0, -8.5),
    seg(0, -3, 0, 2.4),
    dot(0, 5, 0.5),
  ]),
  [
    ring(0, 0, 9, 9),
    seg(-3.6, -4.6, -3.6, 4.6),
    seg(3.6, -4.6, 3.6, 4.6),
    seg(-3.6, -4.6, 3.6, 4.6),
    seg(-3.6, 4.6, -1.3, 1.66),
    seg(3.6, -4.6, 1.3, -1.66),
  ],
  shift(0.75, [
    ring(0, 1.8, 4, 5),
    ring(0, -4.6, 2.2, 1.8),
    seg(0, -2.8, 0, 6.8),
    ...mirror([
      seg(-1.2, -6.2, -3, -8.5),
      seg(-4, -0.5, -8, -2.5),
      seg(-4.1, 2, -8.5, 2),
      seg(-3.8, 4.6, -7.8, 7),
    ]),
  ]),
  shift(-0.4, [arc(0, -3, 3.4, P / 2, 5.93), arc(0, 3.8, 3.4, -P / 2, 2.79), seg(0, -8.4, 0, 9.2)]),
];

function distance(list: Part[], x: number, y: number): number {
  let best = 99;
  for (const p of list) {
    let d: number;
    if (p.k === 's') {
      const vx = p.bx - p.ax,
        vy = p.by - p.ay;
      const t = Math.max(0, Math.min(1, ((x - p.ax) * vx + (y - p.ay) * vy) / (vx * vx + vy * vy)));
      d = Math.hypot(x - p.ax - t * vx, y - p.ay - t * vy);
    } else if (p.k === 'd') {
      d = Math.max(0, Math.hypot(x - p.cx, y - p.cy) - p.r);
    } else if (p.k === 'e') {
      const u = (x - p.cx) / p.rx,
        v = (y - p.cy) / p.ry,
        k = Math.hypot(u, v);
      d = k < 1e-3 ? Math.min(p.rx, p.ry) : (Math.abs(k - 1) * k) / Math.hypot(u / p.rx, v / p.ry);
    } else {
      let a = Math.atan2(y - p.cy, x - p.cx);
      while (a < p.a0) a += 2 * P;
      while (a >= p.a0 + 2 * P) a -= 2 * P;
      const end = (b: number) =>
        Math.hypot(x - p.cx - p.r * Math.cos(b), y - p.cy - p.r * Math.sin(b));
      d =
        a <= p.a1 ? Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r) : Math.min(end(p.a0), end(p.a1));
    }
    if (d < best) best = d;
  }
  return best;
}

function noise(i: number, n: number): number {
  const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function frame(ms: number): string {
  const hold = 1600,
    morph = 1000,
    H = 24,
    a = 9.2 / 12,
    W = Math.round(24 / a),
    hw = 0.55;
  const k = Math.floor(ms / (hold + morph)),
    p = ms % (hold + morph);
  const from = glyphs[k % glyphs.length]!,
    to = glyphs[(k + 1) % glyphs.length]!;
  const s = p < hold ? -1 : ((p - hold) / morph) * 1.3 - 0.15;
  const tick = Math.floor(ms / 80);
  const ry = 0.38 * Math.sin(ms / 1500),
    rz = 0.09 * Math.sin(ms / 2300 + 1),
    bob = 0.6 * Math.sin(ms / 1100);
  const cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  const ramp = ' .:-=+*#%@';
  let out = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = (x + 0.5 - W / 2) * a,
        Y = y + 0.5 - H / 2 - bob;
      const xr = X * cz + Y * sz,
        yr = -X * sz + Y * cz;
      const gx = xr / (cy - (xr * sy) / 40),
        gy = yr * (1 + (gx * sy) / 40);
      const i = y * W + x;
      const dF = distance(from, gx, gy),
        dT = s < 0 ? 99 : distance(to, gx, gy);
      const r = 0.55 * noise(i, k) + 0.45 * Math.min(1, Math.hypot(gx, gy) / 10);
      let g = from,
        d = dF;
      if (s >= 0 && r < s - 0.15) {
        g = to;
        d = dT;
      } else if (s >= 0 && r <= s + 0.15) {
        out +=
          Math.min(dF, dT) < hw + 1.2 && noise(i, tick) > 0.4
            ? ramp[2 + Math.floor(noise(i + 7, tick) * 8)]
            : ' ';
        continue;
      }
      const c = 0.5 + (hw - d) / 0.8;
      if (c > 0.08) {
        const v = Math.min(1, c + (distance(g, gx - 0.4, gy - 0.4) < d ? -0.2 : 0.15));
        out += noise(i, tick + 5) < 0.015 ? '%' : ramp[Math.max(1, Math.min(9, Math.round(v * 9)))];
      } else out += distance(g, gx - 0.9, gy - 0.9) < hw ? ':' : ' ';
    }
    out += '\n';
  }
  return out;
}

function Sign() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = Date.now();
    const timer = setInterval(() => document.hidden || setMs(Date.now() - start), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <pre className="sign" aria-hidden="true">
      {frame(ms)}
    </pre>
  );
}

function Hero() {
  const t = useT();
  return (
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow">{t('AUTOMATED BUG BOUNTY ON NEAR')}</div>
        <h1>
          <span>{t('If it breaks,')}</span>
          <span>{t('it pays.')}</span>
        </h1>
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
      </div>
      <Sign />
    </section>
  );
}

const garbleChars = '$#@!%&*?<>+=/0123456789';
const garble = (length: number) =>
  Array.from({ length }, () => garbleChars[Math.floor(Math.random() * garbleChars.length)]).join(
    '',
  );

export function Scramble({ value, size = 6 }: { value?: string; size?: number }) {
  const [text, setText] = useState(() => garble(value?.length ?? size));
  const [seen, setSeen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setSeen(true));
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (value !== undefined && matchMedia('(prefers-reduced-motion: reduce)').matches)
      return setText(value);
    const start = Date.now();
    const timer = setInterval(() => {
      if (value === undefined || !seen) return setText(garble(value?.length ?? size));
      const done = Math.floor((Date.now() - start - 250) / 45);
      setText(value.slice(0, Math.max(0, done)) + garble(Math.max(0, value.length - done)));
      if (done >= value.length) clearInterval(timer);
    }, 45);
    return () => clearInterval(timer);
  }, [value, seen, size]);
  return <span ref={ref}>{text}</span>;
}

function Numbers({ data }: { data?: { entries: Entry[]; height: bigint } }) {
  const { meta } = useEnv(),
    t = useT();
  const stats = data && overview(data.entries, data.height, BigInt(meta.min_prepare_window_blocks));
  const items: [string | undefined, string][] = [
    [stats && String(stats.total), 'programs launched'],
    [stats && String(stats.open), 'open right now'],
    [stats && near(stats.paid), 'paid to hackers'],
    [stats && String(stats.breaks), 'breaks proved'],
  ];
  return (
    <>
      <section className="stats" aria-label={t('Live numbers')}>
        {items.map(([value, label]) => (
          <div key={label} className="stat">
            <strong>
              <Scramble value={value} size={3} />
            </strong>
            <span>{t(label)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function HowItWorks() {
  const t = useT();
  const node = (area: string, icon: IconName, title: string, text: string) => (
    <div className={'node ' + area}>
      <Icon name={icon} size={24} />
      <span>
        <b>{t(title)}</b>
        {t(text)}
      </span>
    </div>
  );
  const edge = (area: string, lines: [string, string, boolean?][]) => (
    <div className={'edge ' + area}>
      {lines.map(([n, text, pay]) => (
        <span key={n + text} className={pay ? 'pay' : undefined}>
          <i>{n}</i>
          {t(text)}
        </span>
      ))}
    </div>
  );
  return (
    <section id="how" className="band">
      <div className="eyebrow">{t('HOW IT WORKS')}</div>
      <h2>{t('One frozen rule decides.')}</h2>
      <div className="flow-map">
        {node('project', 'tools', 'PROJECT', 'code, rule, reward')}
        {edge('pc', [
          ['1', 'rule + reward →'],
          ['5', '← no break: refund'],
        ])}
        {node('contract', 'lock', 'CONTRACT', 'escrow on NEAR')}
        {edge('ch', [
          ['2', '← sealed hash'],
          ['5', 'pays the break →', true],
        ])}
        {node('hacker', 'bug', 'HACKER', 'finds a break')}
        {edge('hv', [['3', '← encrypted attack']])}
        {node('verifier', 'play', 'VERIFIER', 'replays the attack')}
        {edge('vc', [['4', '↑ signed verdict']])}
      </div>
    </section>
  );
}

function Why() {
  const t = useT();
  return (
    <section id="why" className="band">
      <div className="eyebrow">{t('REAL INCIDENTS')}</div>
      <h2>{t('Agents already lost money.')}</h2>
      <p className="muted">
        {t(
          'Each break below cost more than a bounty. Here you pay only the reward you set, and only when someone proves a break.',
        )}
      </p>
      <div className="showcase">
        {incidents.map(([name, logo, when, loss, text, source, href]) => (
          <a key={name} href={href} target="_blank" rel="noopener noreferrer">
            <span className="logo">
              {logo ? <img src={logo} alt="" /> : <Icon name="coins" size={28} />}
            </span>
            <span className="when">
              {name} · {t(when)}
            </span>
            <b className="loss">
              <Scramble value={loss} />
            </b>
            <span>{t(text)}</span>
            <span className="source">{source} ↗</span>
          </a>
        ))}
      </div>
      <p className="hint">
        {t('Losses as reported at the time. Sources differ on exact amounts.')}
      </p>
      <a className="more" href="#/incidents">
        {t('All {n} incidents since 2016 →', { n: String(all.length) })}
      </a>
      <div className="tiles">
        {prices.map(([tag, title, text]) => (
          <div key={tag} className="tile">
            <span className="tag">{t(tag)}</span>
            <strong>{t(title)}</strong>
            <span className="muted">{t(text)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Landing() {
  const { chain } = useEnv(),
    t = useT();
  const data = useAsync(() => chain.allBounties(), []);
  return (
    <div className="wrap">
      <Hero />
      <Numbers data={data.value} />
      {data.error && (
        <p className="error-text">
          {t('Chain data unavailable. Try again.')}{' '}
          <button type="button" className="chip" onClick={data.reload}>
            {t('Retry')}
          </button>
        </p>
      )}
      <HowItWorks />
      <Why />
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
