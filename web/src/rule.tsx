import type { TargetConfig } from './env.js';

export type RuleProblem = [message: string, value?: string];

const word = /[A-Za-z0-9_.*-]/;
const account = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const number = /^(?:0|[1-9][0-9]{0,38})$/;
const variables = ['amount', 'total', 'payments', 'balance', 'recipient_total'];
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

export function ruleProblem(text: string): RuleProblem | undefined {
  try {
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
    };
    const condition = () => {
      const name = next().toLowerCase();
      if (name === 'recipient') {
        const negate = eat('not');
        if (eat('in')) {
          expect('{');
          pattern();
          while (eat(',')) pattern();
          return expect('}');
        }
        if (negate || !['=', '!='].includes(next())) fail('recipient takes =, != or in {…}');
        return pattern();
      }
      if (!variables.includes(name)) fail('Unknown word "{value}"', name);
      if (!comparisons.includes(next())) fail('{value} needs a comparison', name);
      if (!number.test(next())) fail('{value} compares with a whole number', name);
    };
    const unary = (): void => {
      if (++depth > 32) fail('Too many brackets');
      if (eat('not')) unary();
      else if (eat('(')) {
        any();
        expect(')');
      } else condition();
      depth--;
    };
    const all = () => {
      unary();
      while (eat('and')) unary();
    };
    const any = () => {
      all();
      while (eat('or')) all();
    };
    any();
    if (at < list.length) fail('Unexpected "{value}"', list[at]);
  } catch (error) {
    if (Array.isArray(error)) return error as RuleProblem;
    throw error;
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
