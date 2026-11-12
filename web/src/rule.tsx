import type { TargetConfig } from './env.js';

export type RuleProblem = [message: string, value?: string];

type Variable = 'amount' | 'total' | 'payments' | 'balance' | 'recipient_total';
type Rule =
  | { op: 'or' | 'and'; a: Rule; b: Rule }
  | { op: 'not'; a: Rule }
  | { op: 'in'; set: string[] }
  | { op: 'cmp'; name: Variable; cmp: string; n: bigint };
type State = Record<Variable, bigint> & { recipient: string };

const word = /[A-Za-z0-9_.*-]/;
const account = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const number = /^(?:0|[1-9][0-9]{0,38})$/;
const variables: Variable[] = ['amount', 'total', 'payments', 'balance', 'recipient_total'];
const comparisons = ['=', '!=', '<', '<=', '>', '>='];
const symbols: Record<string, string> = { '≤': '<=', '≥': '>=', '≠': '!=' };

const fail = (...problem: RuleProblem): never => {
  throw problem;
};

function tokens(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    const c = text[i]!;
    const eq = text[i + 1] === '=';
    let j = i + 1;
    if (/\s/.test(c)) {
    } else if ('(){},'.includes(c)) out.push(c);
    else if (c === '=' || c === '<' || c === '>' || (c === '!' && eq)) {
      out.push(c === '=' || !eq ? c : c + '=');
      if (eq) j++;
    } else if (symbols[c]) out.push(symbols[c]);
    else if (word.test(c)) {
      while (j < text.length && word.test(text[j]!)) j++;
      out.push(text.slice(i, j));
    } else fail('Unexpected "{value}"', c);
    i = j;
  }
  return out;
}

function parse(text: string): Rule {
  if (text.length > 4096) fail('The rule is too long');
  const list = tokens(text);
  if (!list.length) fail('Write a rule');
  let at = 0,
    depth = 0;
  const eat = (w: string) => {
    if (list[at]?.toLowerCase() !== w) return false;
    at++;
    return true;
  };
  const next = () => {
    if (at >= list.length) fail('The rule ends too early');
    return list[at++]!;
  };
  const expect = (w: string) => {
    if (!eat(w)) fail('Expected "{value}"', w);
  };
  const pattern = () => {
    const p = next();
    if (!account.test(p.replace(/^\*\./, ''))) fail('"{value}" is not an account', p);
    return p;
  };
  const condition = (): Rule => {
    const name = next().toLowerCase();
    if (name === 'recipient') {
      const negate = eat('not');
      if (eat('in')) {
        expect('{');
        const set = [pattern()];
        while (eat(',')) set.push(pattern());
        expect('}');
        return negate ? { op: 'not', a: { op: 'in', set } } : { op: 'in', set };
      }
      const cmp = negate ? '' : next();
      if (cmp !== '=' && cmp !== '!=') fail('recipient takes =, != or in {…}');
      const rule: Rule = { op: 'in', set: [pattern()] };
      return cmp === '=' ? rule : { op: 'not', a: rule };
    }
    if (!variables.includes(name as Variable)) fail('Unknown word "{value}"', name);
    const cmp = next();
    if (!comparisons.includes(cmp)) fail('{value} needs a comparison', name);
    const n = next();
    if (!number.test(n)) fail('{value} compares with a whole number', name);
    return { op: 'cmp', name: name as Variable, cmp, n: BigInt(n) };
  };
  const unary = (): Rule => {
    if (++depth > 32) fail('Too many brackets');
    let rule: Rule;
    if (eat('not')) rule = { op: 'not', a: unary() };
    else if (eat('(')) {
      rule = any();
      expect(')');
    } else rule = condition();
    depth--;
    return rule;
  };
  const all = () => {
    let rule = unary();
    while (eat('and')) rule = { op: 'and', a: rule, b: unary() };
    return rule;
  };
  const any = () => {
    let rule = all();
    while (eat('or')) rule = { op: 'or', a: rule, b: all() };
    return rule;
  };
  const rule = any();
  if (at < list.length) fail('Unexpected "{value}"', list[at]);
  return rule;
}

function holds(rule: Rule, s: State): boolean {
  switch (rule.op) {
    case 'or':
      return holds(rule.a, s) || holds(rule.b, s);
    case 'and':
      return holds(rule.a, s) && holds(rule.b, s);
    case 'not':
      return !holds(rule.a, s);
    case 'in':
      return rule.set.some((p) =>
        p.startsWith('*.') ? s.recipient.endsWith(p.slice(1)) : p === s.recipient,
      );
    case 'cmp': {
      const x = s[rule.name];
      return {
        '=': x === rule.n,
        '!=': x !== rule.n,
        '<': x < rule.n,
        '<=': x <= rule.n,
        '>': x > rule.n,
        '>=': x >= rule.n,
      }[rule.cmp]!;
    }
  }
}

function atoms(rule: Rule): Rule[] {
  return 'b' in rule ? [...atoms(rule.a), ...atoms(rule.b)] : 'a' in rule ? atoms(rule.a) : [rule];
}

function outcomes(rule: Rule): { can: Set<boolean>; recipients: number } | undefined {
  const leaves = atoms(rule);
  const used = variables.filter((v) => leaves.some((l) => l.op === 'cmp' && l.name === v));
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
  const values: Partial<Record<Variable, bigint>> = {};
  const visit = (i: number) => {
    if (can.size === 2) return;
    if (i < used.length) {
      for (const n of pool) {
        values[used[i]!] = n;
        visit(i + 1);
      }
      return;
    }
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
        holds(rule, {
          amount,
          payments,
          recipient_total,
          total,
          balance: values.balance ?? 0n,
          recipient,
        }),
      );
  };
  visit(0);
  return { can, recipients: leaves.filter((l) => l.op === 'in').length };
}

export function ruleProblem(text: string): RuleProblem | undefined {
  try {
    const result = outcomes(parse(text));
    if (result && !result.can.has(false))
      return ['Every payment keeps this rule true, so no attack can win'];
  } catch (error) {
    if (Array.isArray(error)) return error as RuleProblem;
    throw error;
  }
}

export function ruleNote(text: string): [note: string, warn: boolean] | undefined {
  try {
    const result = outcomes(parse(text));
    if (!result || result.can.has(true)) return undefined;
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
  [/^(recipient|amount|total|payments|balance|recipient_total)$/i, 'var'],
];

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
