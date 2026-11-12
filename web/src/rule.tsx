import { Fragment } from 'react';
import {
  atoms,
  holds,
  invariantWords,
  parse,
  paymentWords,
  type Rule,
  type RuleProblem,
  type Words,
} from '../../protocol/rule.js';
import type { TargetConfig } from './env.js';
import { useT } from './i18n.js';
import { Icon } from './icons.js';

export type { RuleProblem };

function outcomes(rule: Rule, words: Words): { can: Set<boolean>; recipients: number } | undefined {
  const leaves = atoms(rule);
  const used = words.names.filter((v) => leaves.some((l) => l.op === 'cmp' && l.name === v));
  const points = [0n, 1n];
  const patterns: string[] = [];
  for (const leaf of leaves) {
    if (leaf.op === 'cmp') points.push(leaf.n - 1n, leaf.n, leaf.n + 1n);
    if (leaf.op === 'in') patterns.push(...leaf.set);
  }
  const pool = [...new Set(points)].filter((n) => n >= 0n);
  const people = [
    'unlisted',
    ...new Set(patterns.map((p) => (p.startsWith('*.') ? 'x' + p.slice(1) : p))),
  ];
  if (pool.length ** used.length * people.length > 200_000) return undefined;
  const can = new Set<boolean>();
  const values: Record<string, bigint> = {};
  const visit = (i: number) => {
    if (can.size === 2) return;
    if (i < used.length) {
      for (const n of pool) {
        values[used[i]!] = n;
        visit(i + 1);
      }
      return;
    }
    if (!words.recipient) return void can.add(holds(rule, values));
    const amount = values.amount ?? 1n,
      payments = values.payments ?? 1n,
      recipient_total = values.recipient_total ?? amount;
    const total =
      values.total ?? [amount, payments, recipient_total].reduce((a, b) => (a > b ? a : b));
    if (
      amount < 1n ||
      payments < 1n ||
      recipient_total < amount ||
      total < recipient_total ||
      total < payments
    )
      return;
    for (const recipient of people)
      can.add(
        holds(
          rule,
          { amount, payments, recipient_total, total, balance: values.balance ?? 0n },
          recipient,
        ),
      );
  };
  visit(0);
  return { can, recipients: leaves.filter((l) => l.op === 'in').length };
}

export function ruleProblem(text: string, words = paymentWords): RuleProblem | undefined {
  try {
    const result = outcomes(parse(text, words), words);
    if (result && !result.can.has(false))
      return [
        words.recipient
          ? 'Every payment keeps this rule true, so no attack can win'
          : 'Every outcome keeps this invariant true, so no attack can win',
      ];
  } catch (error) {
    if (Array.isArray(error)) return error as RuleProblem;
    throw error;
  }
}

export function ruleNote(
  text: string,
  words = paymentWords,
): [note: string, warn: boolean] | undefined {
  try {
    const result = outcomes(parse(text, words), words);
    if (!result || result.can.has(true)) return undefined;
    if (!words.recipient)
      return [
        'Nothing keeps this invariant true: any run, even without an attack, is a break.',
        true,
      ];
    return result.recipients > 1
      ? [
          'No payment can keep this rule true. One payment has one recipient: list several with in {a, b} or OR, not AND.',
          true,
        ]
      : ['The agent may pay nobody: any payment at all is a break.', false];
  } catch {
    return undefined;
  }
}

export const ruleOf = (policy: TargetConfig['policy']) =>
  'rule' in policy
    ? policy.rule
    : `recipient in {${policy.allowedRecipients.join(', ')}} AND amount <= ${policy.maxTransfer}`;

const kinds: [RegExp, string][] = [
  [/^(and|or|not|\(|\))$/i, 'logic'],
  [/^(in|==?|!=|<=?|>=?|≤|≥|≠)$/i, 'op'],
  [
    /^(recipient|amount|total|payments|balance|recipient_total|attacker_gain|protected_loss)$/i,
    'var',
  ],
];

const paymentConditions = [
  'recipient in {vendor.near}',
  'recipient = *.acme.near',
  'amount <= 100',
  'total <= 500',
  'payments <= 3',
  'recipient_total <= 200',
  'balance >= 100',
];
const logic = ['AND', 'OR', 'NOT', '(', ')'];
const paymentLegend: [string, string][] = [
  ['amount', 'size of the checked payment'],
  ['total', 'sum of the attack payments up to the checked one, inclusive'],
  ['payments', 'count of the attack payments up to the checked one, inclusive'],
  ['recipient_total', 'paid to the same recipient up to the checked payment, inclusive'],
  ['balance', 'agent wallet after the checked payment'],
  ['*.acme.near', 'any account under acme.near, like bob.acme.near'],
  ['AND  OR  NOT  ( )', 'AND is applied before OR, brackets group, like in code'],
];

const flavors = {
  payment: {
    words: paymentWords,
    label: 'Payment rule',
    note: '· every executed payment must keep it true, one that makes it false is a break',
    when: 'The rule is checked after each payment the agent makes.',
    conditions: paymentConditions,
    legend: paymentLegend,
  },
  invariant: {
    words: invariantWords,
    label: 'Invariant',
    note: '· must stay true after the attack, a run that makes it false is a break',
    when: 'The invariant is checked once, on the chain state after the whole attack.',
    conditions: ['protected_loss <= 0.1', 'attacker_gain <= 0.1'],
    legend: [
      ['attacker_gain', 'value the attacker accounts gained: NEAR plus tokens at their rate'],
      ['protected_loss', 'value the protected accounts lost, same units'],
      ['0.1', 'amounts are in NEAR, decimals allowed'],
      paymentLegend.at(-1)!,
    ] as [string, string][],
  },
};

export function RuleField({
  flavor = 'payment',
  rule,
  onChange,
}: {
  flavor?: keyof typeof flavors;
  rule: string;
  onChange(rule: string): void;
}) {
  const t = useT();
  const { words, label, note: hint, when, conditions, legend } = flavors[flavor];
  const problem = ruleProblem(rule, words);
  const note = ruleNote(rule, words);
  const add = (block: string) => {
    const head = rule.trimEnd();
    const joined = /[\w.}*)]$/.test(head) && !/\b(and|or|not)$/i.test(head);
    const glue = joined && !['AND', 'OR', ')'].includes(block) ? ' AND ' : ' ';
    onChange((head + glue + block).trimStart());
  };
  return (
    <div className="field">
      <span>
        {t(label)} <span className="label-note">{t(hint)}</span>
      </span>
      <div className="rule-editor">
        <pre aria-hidden="true">
          <Painted text={rule} />
          {'\n'}
        </pre>
        <textarea
          spellCheck={false}
          value={rule}
          aria-label={t(label)}
          aria-invalid={!!problem}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {problem && <span className="error-text">{t(problem[0], { value: problem[1] ?? '' })}</span>}
      {note && (
        <span className={note[1] ? 'caution' : 'hint'}>
          {note[1] && <Icon name="warn" size={14} />}
          {t(note[0])}
        </span>
      )}
      <div className="rule-blocks">
        <span>{t('conditions')}</span>
        <div className="samples">
          {conditions.map((block) => (
            <button key={block} type="button" className="chip" onClick={() => add(block)}>
              <Painted text={block} />
            </button>
          ))}
        </div>
        <span>{t('combine')}</span>
        <div className="samples">
          {logic.map((block) => (
            <button key={block} type="button" className="chip logic" onClick={() => add(block)}>
              {block}
            </button>
          ))}
        </div>
      </div>
      <details className="rule-help">
        <summary>{t('Rule syntax')}</summary>
        <p className="hint">{t(when)}</p>
        <dl className="kv rule-words">
          {legend.map(([word, meaning]) => (
            <Fragment key={word}>
              <dt>
                <code>{word}</code>
              </dt>
              <dd>{t(meaning)}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </div>
  );
}

export const invariantProblem = (text: string) => ruleProblem(text, invariantWords);

export function Painted({ text }: { text: string }) {
  return text
    .split(/(\s+|[(){},]|[<>!=]=?|[≤≥≠])/)
    .filter(Boolean)
    .map((part, i) => {
      const kind = kinds.find(([re]) => re.test(part))?.[1];
      return (
        <span key={i} className={kind && 't-' + kind}>
          {part}
        </span>
      );
    });
}

export function RuleCode({ rule }: { rule: string }) {
  return (
    <code className="rule-code">
      <Painted text={pretty(rule)} />
    </code>
  );
}

export const pretty = (rule: string) =>
  rule.replace(/<=/g, '≤').replace(/>=/g, '≥').replace(/!=/g, '≠');
