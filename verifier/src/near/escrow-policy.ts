import type { NearRpc } from './rpc.ts';
import { accountId, object } from './validation.ts';

export async function auditEscrowPolicy(rpc:Pick<NearRpc,'snapshot'|'call'>,contract:string,expectedCodeHash:string) {
  accountId(contract);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(expectedCodeHash)||expectedCodeHash==='11111111111111111111111111111111') throw new Error('Invalid pinned escrow code hash');
  const snapshot=await rpc.snapshot();
  const [accountRaw,keysRaw]=await Promise.all([
    rpc.call('query',{request_type:'view_account',account_id:contract,block_id:snapshot.hash}),
    rpc.call('query',{request_type:'view_access_key_list',account_id:contract,block_id:snapshot.hash}),
  ]);
  const account=object(accountRaw,'escrow account'),keys=object(keysRaw,'escrow keys');
  for(const result of [account,keys]) if(result.block_hash!==snapshot.hash||result.block_height!==Number(snapshot.height)) throw new Error('Escrow audit snapshot mismatch');
  if(account.code_hash!==expectedCodeHash||account.global_contract_hash!=null||account.global_contract_account_id!=null) throw new Error('Escrow contract code differs from pinned local deployment');
  if(!Array.isArray(keys.keys)||keys.keys.length!==0) throw new Error('Escrow account still has upgrade access keys');
  return {contract,code_hash:expectedCodeHash,finalized_block:snapshot.hash,height:snapshot.height.toString(),access_keys:0};
}
