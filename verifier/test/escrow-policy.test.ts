import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEscrowPolicy } from '../src/near/escrow-policy.ts';
import type { NearRpc } from '../src/near/rpc.ts';

const hash='2'.repeat(43);
function rpc(keys:unknown[],codeHash=hash):Pick<NearRpc,'snapshot'|'call'> {
  return {
    async snapshot(){return {hash:'finalized-block',height:42n};},
    async call(_method,params){
      const base={block_hash:'finalized-block',block_height:42};
      if(params.request_type==='view_account') return {...base,code_hash:codeHash,global_contract_hash:null,global_contract_account_id:null};
      if(params.request_type==='view_access_key_list') return {...base,keys};
      throw new Error('Unexpected query');
    },
  };
}

test('immutable pinned escrow is eligible for funding',async()=>{
  const result=await auditEscrowPolicy(rpc([]),'bounty.testnet',hash);
  assert.equal(result.access_keys,0);
  assert.equal(result.finalized_block,'finalized-block');
});
test('escrow with an upgrade key is rejected before funding',async()=>{
  await assert.rejects(auditEscrowPolicy(rpc([{public_key:'ed25519:key'}]),'bounty.testnet',hash),/upgrade access keys/);
});
test('escrow code must match the pinned deployment',async()=>{
  await assert.rejects(auditEscrowPolicy(rpc([],'3'.repeat(43)),'bounty.testnet',hash),/code differs/);
});
