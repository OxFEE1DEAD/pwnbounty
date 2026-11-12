export type RuleProblem = [message: string, value?: string];
export type Rule =
  | { op: 'or' | 'and'; a: Rule; b: Rule }
  | { op: 'not'; a: Rule }
  | { op: 'in'; set: string[] }
  | { op: 'cmp'; name: string; cmp: string; n: bigint };
export interface Words {
  names: string[];
  decimals: number;
  recipient: boolean;
}

export const paymentWords: Words = {
  names: ['amount', 'total', 'payments', 'balance', 'recipient_total'],
  decimals: 0,
  recipient: true,
};
export const invariantWords: Words = {
  names: ['attacker_gain', 'protected_loss'],
  decimals: 24,
  recipient: false,
};

export const withReads = (names: string[]): Words => ({
  ...invariantWords,
  names: [...invariantWords.names, ...names],
});

const word = /[A-Za-z0-9_.*-]/;
const account = /^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
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

function amount(text: string, decimals: number): bigint | undefined {
  const match = /^(0|[1-9][0-9]{0,38})(?:\.([0-9]+))?$/.exec(text);
  if (!match || (match[2] ?? '').length > decimals) return undefined;
  return BigInt(match[1]! + (match[2] ?? '').padEnd(decimals, '0'));
}

export function parse(text: string, words: Words = paymentWords): Rule {
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
    if (name === 'recipient' && words.recipient) {
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
    if (!words.names.includes(name)) fail('Unknown word "{value}"', name);
    const cmp = next();
    if (!comparisons.includes(cmp)) fail('{value} needs a comparison', name);
    const n = amount(next(), words.decimals);
    if (n === undefined)
      fail(
        words.decimals
          ? '{value} compares with an amount in NEAR'
          : '{value} compares with a whole number',
        name,
      );
    return { op: 'cmp', name, cmp, n: n! };
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

export function holds(rule: Rule, values: Record<string, bigint>, recipient = ''): boolean {
  switch (rule.op) {
    case 'or':
      return holds(rule.a, values, recipient) || holds(rule.b, values, recipient);
    case 'and':
      return holds(rule.a, values, recipient) && holds(rule.b, values, recipient);
    case 'not':
      return !holds(rule.a, values, recipient);
    case 'in':
      return rule.set.some((p) =>
        p.startsWith('*.') ? recipient.endsWith(p.slice(1)) : p === recipient,
      );
    case 'cmp': {
      const x = values[rule.name] ?? 0n;
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

export function atoms(rule: Rule): Rule[] {
  return 'b' in rule ? [...atoms(rule.a), ...atoms(rule.b)] : 'a' in rule ? atoms(rule.a) : [rule];
}
