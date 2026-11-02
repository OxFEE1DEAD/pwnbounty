import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { promisify } from 'node:util';
import { canonical } from '../../../protocol/index.ts';
import { object, bytes32 } from '../near/validation.ts';

const execute=promisify(execFile);
export function provisioning(value:unknown) {
  const p=object(value,'OutLayer provisioning');
  const signing=bytes32(p.signing_public_key,'provisioned signing key');
  const encryption=bytes32(p.encryption_public_key,'provisioned encryption key');
  if(signing.every(b=>b===0)||encryption.every(b=>b===0)||typeof p.sealed_state!=='string') throw new Error('Invalid provisioned keys');
  const state=Buffer.from(p.sealed_state,'base64');
  if(state.length!==73||state.toString('base64')!==p.sealed_state) throw new Error('Invalid provisioned sealed state');
  return {signing_public_key:signing.toString('base64'),encryption_public_key:encryption.toString('base64'),sealed_state:p.sealed_state};
}
async function jsonFile(path:string,max:number):Promise<unknown> {
  if((await stat(path)).size>max) throw new Error('Provisioning evidence file too large');
  return JSON.parse(await readFile(path,'utf8'));
}

export async function loadVerifiedProvisioning(path:string,expected:{network:'mainnet'|'testnet';project:string;versionHash:string;verifyBin?:string}) {
  const artifact=object(await jsonFile(path,8192),'provisioning artifact');
  const keys=provisioning(artifact);
  if(typeof artifact.evidence_file!=='string') throw new Error('Missing provisioning evidence file');
  const saved=object(await jsonFile(resolve(dirname(resolve(path)),artifact.evidence_file),4_000_000),'saved provisioning bundle');
  const attestation=object(saved.attestation,'saved attestation');
  const callId=attestation.call_id;
  if(typeof callId!=='string'||!/^[0-9a-f-]{36}$/i.test(callId)) throw new Error('Missing provisioning call ID');
  if(canonical(saved.input)!==canonical({action:'provision'})) throw new Error('Evidence is not a provisioning execution');
  const output=typeof saved.output==='string'?JSON.parse(saved.output):saved.output;
  if(canonical(provisioning(output))!==canonical(keys)) throw new Error('Provisioning artifact differs from attested output');
  const directory=await mkdtemp(join(tmpdir(),'sealed-bounty-provision-proof-'));
  try {
    const input=join(directory,'input.json'),response=join(directory,'output.json'),fresh=join(directory,'proof.json');
    await writeFile(input,JSON.stringify(saved.input),{mode:0o600,flag:'wx'});
    await writeFile(response,JSON.stringify(saved.output),{mode:0o600,flag:'wx'});
    let stdout:string;
    try { ({stdout}=await execute(expected.verifyBin||'outlayer-verify',['call',callId,'--network',expected.network,'--input',input,'--output',response,'--json','--bundle',fresh],{encoding:'utf8',timeout:120_000,maxBuffer:2_000_000})); }
    catch { throw new Error('Provisioning execution could not be reverified against chain approval'); }
    const proof=object(JSON.parse(stdout),'provisioning verification');
    for(const field of ['authenticity','identity','binding','input','output']) {
      if(object(proof[field],field).verdict!=='pass') throw new Error('Provisioning proof is incomplete');
    }
    if(proof.format!=='V1'||(proof.uncovered_fields!==undefined&&(!Array.isArray(proof.uncovered_fields)||proof.uncovered_fields.length!==0))) throw new Error('Provisioning identity fields are not bound');
    const bundle=object(await jsonFile(fresh,4_000_000),'fresh provisioning bundle');
    const record=object(bundle.attestation,'fresh provisioning attestation');
    if(bundle.bundle_format!==1||bundle.network!==expected.network||record.wasm_hash!==expected.versionHash||record.project_id!==expected.project||record.call_id!==callId) throw new Error('Provisioning code/project/network mismatch');
    if(canonical(bundle.input)!==canonical(saved.input)||canonical(bundle.output)!==canonical(saved.output)) throw new Error('Provisioning proof payload mismatch');
    return keys;
  } finally { await rm(directory,{recursive:true,force:true}); }
}
