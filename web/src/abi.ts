export interface Param {
  name: string;
  type: string;
  text: boolean;
}
export interface Method {
  kind?: 'view' | 'call';
  init?: boolean;
  payable?: boolean;
  params?: Param[];
}
export type Methods = Record<string, Method>;

const text = (name: string, type = 'string'): Param => ({ name, type, text: true });
const json = (name: string, type: string): Param => ({ name, type, text: false });
const account = text('account_id', 'AccountId');
const receiver = text('receiver_id', 'AccountId');
const standard: Methods = {
  ft_transfer: {
    kind: 'call',
    payable: true,
    params: [receiver, text('amount', 'U128'), text('memo')],
  },
  ft_transfer_call: {
    kind: 'call',
    payable: true,
    params: [receiver, text('amount', 'U128'), text('memo'), text('msg')],
  },
  ft_total_supply: { kind: 'view', params: [] },
  ft_balance_of: { kind: 'view', params: [account] },
  ft_metadata: { kind: 'view', params: [] },
  storage_deposit: {
    kind: 'call',
    payable: true,
    params: [account, json('registration_only', 'boolean')],
  },
  storage_withdraw: { kind: 'call', payable: true, params: [text('amount', 'U128')] },
  storage_unregister: { kind: 'call', payable: true, params: [json('force', 'boolean')] },
  storage_balance_of: { kind: 'view', params: [account] },
  storage_balance_bounds: { kind: 'view', params: [] },
  nft_transfer: {
    kind: 'call',
    payable: true,
    params: [receiver, text('token_id', 'TokenId'), json('approval_id', 'u64'), text('memo')],
  },
  nft_transfer_call: {
    kind: 'call',
    payable: true,
    params: [
      receiver,
      text('token_id', 'TokenId'),
      json('approval_id', 'u64'),
      text('memo'),
      text('msg'),
    ],
  },
  nft_token: { kind: 'view', params: [text('token_id', 'TokenId')] },
  nft_total_supply: { kind: 'view', params: [] },
  nft_tokens_for_owner: {
    kind: 'view',
    params: [account, text('from_index', 'U128'), json('limit', 'u64')],
  },
};

type Schema = { type?: string | string[]; $ref?: string };
interface Abi {
  body?: {
    functions?: {
      name: string;
      kind?: 'view' | 'call';
      modifiers?: string[];
      params?: { serialization_type?: string; args?: { name: string; type_schema?: Schema }[] };
    }[];
    root_schema?: { definitions?: Record<string, Schema> };
  };
}

export function wasmMethods(bytes: Uint8Array): Methods {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== '\0asm')
    throw new Error('This file is not a .wasm build');
  const methods: Methods = {};
  let at = 8;
  const leb = () => {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = bytes[at++];
      if (byte === undefined) throw new Error('This file is not a .wasm build');
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
  };
  while (at < bytes.length) {
    const section = bytes[at++];
    const size = leb();
    const end = at + size;
    if (section === 7) {
      for (let count = leb(); count > 0; count--) {
        const length = leb();
        const name = new TextDecoder().decode(bytes.subarray(at, at + length));
        at += length;
        const kind = bytes[at++];
        leb();
        if (kind === 0 && !name.startsWith('__')) methods[name] = { ...standard[name] };
      }
    }
    at = end;
  }
  return methods;
}

export function readAbi(json: string): Methods {
  const abi = JSON.parse(json) as Abi;
  const functions = abi.body?.functions;
  if (!Array.isArray(functions)) throw new Error('This is not a NEAR ABI file');
  const definitions = abi.body?.root_schema?.definitions ?? {};
  const param = ({ name, type_schema: schema = {} }: { name: string; type_schema?: Schema }) => {
    const ref = schema.$ref?.split('/').pop();
    const types = [(ref && definitions[ref]?.type) || schema.type || []].flat();
    return { name, type: ref ?? (types.join(' | ') || 'json'), text: types.includes('string') };
  };
  return Object.fromEntries(
    functions.map((f) => [
      f.name,
      {
        kind: f.kind,
        init: f.modifiers?.includes('init'),
        payable: f.modifiers?.includes('payable'),
        params:
          f.params?.serialization_type === 'borsh' ? undefined : (f.params?.args ?? []).map(param),
      },
    ]),
  );
}
