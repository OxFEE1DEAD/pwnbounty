import { useEffect, useRef, useState } from 'react';
import data from './incidents.json';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

type Incident = {
  id: string;
  name: string;
  date: string;
  kind: 'agent' | 'contract' | 'bridge' | 'research';
  chain: string;
  vector: string;
  loss_usd: number;
  loss_text: string;
  summary: string;
  preventable: 'yes' | 'partly' | 'no';
  why: string;
  source: { name: string; url: string };
};

export const incidents = data as Incident[];

const kinds: [string, (i: Incident) => boolean][] = [
  ['All', () => true],
  ['AI agents', (i) => i.kind === 'agent' || i.kind === 'research'],
  ['Contracts', (i) => i.kind === 'contract'],
  ['Bridges', (i) => i.kind === 'bridge'],
];
const verdicts = {
  yes: 'findable before launch',
  partly: 'partly findable',
  no: 'not in the code',
};

const caught = (i: Incident) => i.preventable !== 'no';
const sum = (list: Incident[]) => list.reduce((total, i) => total + i.loss_usd, 0);

export function usd(n: number): string {
  const [value, unit] = n >= 1e9 ? [n / 1e9, 'B'] : n >= 1e6 ? [n / 1e6, 'M'] : [n / 1e3, 'K'];
  if (!n) return '$0';
  return `$${value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, '')}${unit}`;
}

function Chart({ list }: { list: Incident[] }) {
  const t = useT();
  const [hover, setHover] = useState<number>();
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    if (plot.current) {
      setWidth(plot.current.clientWidth);
      observer.observe(plot.current);
    }
    return () => observer.disconnect();
  }, []);
  const first = 2016;
  const last = Math.max(...incidents.map((i) => Number(i.date.slice(0, 4))));
  const years = Array.from({ length: last - first + 1 }, (_, k) => {
    const year = first + k;
    const rows = list.filter((i) => i.date.startsWith(String(year)));
    return {
      year,
      rows,
      caught: sum(rows.filter(caught)),
      other: sum(rows.filter((i) => !caught(i))),
    };
  });
  const peak = Math.max(1, ...years.map((y) => y.caught + y.other));
  const step = 10 ** Math.floor(Math.log10(peak));
  const top = Math.ceil(peak / step) * step;
  const [height, left, bottom] = [240, 52, 22];
  const slot = (width - left) / years.length;
  const bar = Math.min(24, slot * 0.6);
  const y = (value: number) => ((height - bottom) * (top - value)) / top;
  const column = (x: number, from: number, to: number, round: boolean) => {
    const [y0, y1] = [y(from), y(to)];
    if (y0 - y1 < 0.5) return '';
    const r = round ? Math.min(4, y0 - y1) : 0;
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bar - r}Q${x + bar},${y1} ${x + bar},${y1 + r}V${y0}Z`;
  };
  const labelled = new Set([
    years.reduce((a, b) => (b.caught + b.other > a.caught + a.other ? b : a)).year,
    last,
  ]);
  const shown = hover === undefined ? undefined : years[hover];
  return (
    <figure className="loss-chart">
      <div className="legend">
        <span>
          <i className="swatch caught" /> {t('findable before launch')}
        </span>
        <span>
          <i className="swatch other" /> {t('not in the code: keys, insiders, fake front-ends')}
        </span>
      </div>
      <div className="plot" ref={plot}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={t('Losses per year')}
        >
          {[0, top / 2, top].map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width} y1={y(tick)} y2={y(tick)} className="grid" />
              <text x={left - 8} y={y(tick) + 4} textAnchor="end">
                {usd(tick)}
              </text>
            </g>
          ))}
          {years.map((entry, k) => {
            const x = left + k * slot + (slot - bar) / 2;
            const total = entry.caught + entry.other;
            const gap = entry.caught && entry.other ? (top * 2) / (height - bottom) : 0;
            return (
              <g
                key={entry.year}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover(undefined)}
              >
                <rect x={left + k * slot} y={0} width={slot} height={height} className="hit" />
                <path d={column(x, 0, entry.caught, !entry.other)} className="caught" />
                <path d={column(x, entry.caught + gap, total, true)} className="other" />
                {labelled.has(entry.year) && total > 0 && (
                  <text x={x + bar / 2} y={y(total) - 6} textAnchor="middle" className="value">
                    {usd(total)}
                  </text>
                )}
                <text
                  x={x + bar / 2}
                  y={height - 4}
                  textAnchor="middle"
                  className={hover === k ? 'on' : ''}
                >
                  {String(entry.year).slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
        {shown && (
          <div className="tip" style={{ left: left + (hover! + 0.5) * slot }}>
            <b>{shown.year}</b>
            <span>{usd(shown.caught + shown.other)}</span>
            <span>{t('{n} incidents', { n: String(shown.rows.length) })}</span>
            <span>
              <i className="swatch caught" /> {usd(shown.caught)}
            </span>
            <span>
              <i className="swatch other" /> {usd(shown.other)}
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}

export function Incidents() {
  const t = useT();
  const [kind, setKind] = useState(0);
  const list = incidents.filter(kinds[kind]![1]);
  const total = sum(incidents);
  const share = Math.round((sum(incidents.filter(caught)) * 100) / total);
  const years = [...new Set(list.map((i) => i.date.slice(0, 4)))];
  return (
    <div className="wrap">
      <section className="hunt-head">
        <div className="eyebrow">{t('INCIDENTS')}</div>
        <h1>{t('What a break costs.')}</h1>
        <p className="lead">
          {t(
            '{n} of the biggest public breaks since 2016, {total} lost. {share} of it went through bugs someone could find before launch by attacking a copy, the way a bounty here works.',
            { n: String(incidents.length), total: usd(total), share: `${share}%` },
          )}
        </p>
        <p className="hint">
          {t(
            'A selection, not a full list: the largest cases of each year, plus cases on NEAR and with AI agents.',
          )}
        </p>
      </section>
      <div className="samples filters">
        {kinds.map(([label], n) => (
          <button
            key={label}
            type="button"
            className={'chip' + (n === kind ? ' current' : '')}
            onClick={() => setKind(n)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <Chart list={list} />
      {years.map((year) => {
        const rows = list.filter((i) => i.date.startsWith(year));
        return (
          <section key={year} className="incident-year">
            <h3>
              {year}
              <span>
                {usd(sum(rows))} · {t('{n} incidents', { n: String(rows.length) })}
              </span>
            </h3>
            {rows.map((i) => {
              const [loss, note] = i.loss_text.replace(/\)$/, '').split(' (');
              return (
                <article key={i.id} className="incident-row">
                  <span className="muted">{i.date}</span>
                  <div>
                    <strong>{i.name}</strong> <span className="tag">{t(i.kind)}</span>{' '}
                    <span className="muted">
                      {i.chain} · {i.vector}
                    </span>
                    <p>{i.summary}</p>
                    <a href={i.source.url} target="_blank" rel="noopener noreferrer">
                      {i.source.name} ↗
                    </a>
                  </div>
                  <div className="loss">
                    <b>{loss}</b>
                    {note && <small>{note}</small>}
                  </div>
                  <span className={'odds ' + i.preventable} title={i.why}>
                    <Icon name={i.preventable === 'no' ? 'close' : 'check'} size={14} />{' '}
                    {t(verdicts[i.preventable])}
                  </span>
                </article>
              );
            })}
          </section>
        );
      })}
      <p className="hint">
        {t(
          'Summaries are in English. Losses are as reported at the time; sources differ on exact amounts.',
        )}
      </p>
    </div>
  );
}
