type Vars = Record<string, string>;

const fill = (text: string, vars: Vars = {}) =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll('{' + key + '}', value),
    text,
  );

export const useT = () => fill;
