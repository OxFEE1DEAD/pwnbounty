import { NearRpc } from '../near/rpc.ts';
import { accountId, hex, object } from '../near/validation.ts';

export async function auditProjectPolicy(rpc:NearRpc,projectId:string,versionHash:string) {
  const split=projectId.split('/');
  if(split.length!==2||!split[1]) throw new Error('Invalid OutLayer project');
  const owner=accountId(split[0]); hex(versionHash,'WASM hash');
  const snapshot=await rpc.snapshot();
  const contract=rpc.network==='mainnet'?'outlayer.near':'outlayer.testnet';
  const [projectRaw,count,versionsRaw,accountRaw,keysRaw,providerRaw]=await Promise.all([
    rpc.view(contract,'get_project',{project_id:projectId},snapshot),
    rpc.view(contract,'get_version_count',{project_id:projectId},snapshot),
    rpc.view(contract,'list_versions',{project_id:projectId,from_index:0,limit:100},snapshot),
    rpc.call('query',{request_type:'view_account',account_id:owner,block_id:snapshot.hash}),
    rpc.call('query',{request_type:'view_access_key_list',account_id:owner,block_id:snapshot.hash}),
    rpc.call('query',{request_type:'view_account',account_id:contract,block_id:snapshot.hash}),
  ]);
  const project=object(projectRaw,'OutLayer project');
  if(project.owner!==owner||project.project_id!==projectId||project.name!==split[1]||project.active_version!==versionHash||typeof project.uuid!=='string'||!project.uuid) throw new Error('OutLayer project identity/version mismatch');
  if(count!==1||!Array.isArray(versionsRaw)||versionsRaw.length!==1) throw new Error('OutLayer project must contain exactly the pinned version');
  const version=object(versionsRaw[0],'OutLayer version');
  const source=object(object(version.source,'version source').WasmUrl,'WASM URL source');
  if(version.wasm_hash!==versionHash||version.is_active!==true||source.hash!==versionHash||source.build_target!=='wasm32-wasip2') throw new Error('OutLayer version is not the pinned WASI build');
  const account=object(accountRaw,'project owner account'),keys=object(keysRaw,'project owner access keys');
  const provider=object(providerRaw,'OutLayer contract account');
  for(const result of [account,keys,provider]) {
    if(result.block_hash!==snapshot.hash||result.block_height!==Number(snapshot.height)) throw new Error('Owner audit snapshot mismatch');
  }
  if(account.code_hash!=='11111111111111111111111111111111'||account.global_contract_hash!=null||account.global_contract_account_id!=null) throw new Error('OutLayer owner has local or global executable code');
  if(!Array.isArray(keys.keys)||keys.keys.length!==0) throw new Error('OutLayer owner still has access keys');
  return {project:projectId,uuid:project.uuid,wasm_hash:versionHash,owner,outlayer_contract:contract,provider_code_hash:provider.code_hash,provider_global_contract_hash:provider.global_contract_hash??null,provider_global_contract_account_id:provider.global_contract_account_id??null,finalized_block:snapshot.hash,height:snapshot.height.toString(),ordinary_owner_update_paths_disabled:true,provider_governance_trusted:true,pending_owner_receipts_not_excluded:true};
}
