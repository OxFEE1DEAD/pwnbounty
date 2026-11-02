import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { rulesHash } from '../../protocol/index.ts';
import { FileDisclosure } from './disclosure.ts';
import { FileJobStore } from './job-store.ts';
import { NearRpc } from './near/rpc.ts';
import { getProgram, getCommitment } from './near/programs.ts';
import { accountId, hex, object, targetConfig, u64 } from './near/validation.ts';
import { amount } from '../../protocol/index.ts';

export interface ReadApiOptions {
  rpc:NearRpc; contract:string; configDirectory:string; webDirectory:string;
  encryptionPublicKey:string; signingPublicKey:string; attestationHash:string; trustMode:string;
  allowMainnetWrites:boolean;
  token:string; store:FileJobStore; disclosure:FileDisclosure;
}
export function authorized(req:IncomingMessage,token:string):boolean {
  const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from(`Bearer ${token}`);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function json(res:ServerResponse,status:number,value:unknown):void {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}).end(JSON.stringify(value));
}
const assets:Record<string,{file:string;type:string}>={
  '/':{file:'index.html',type:'text/html; charset=utf-8'},
  '/index.html':{file:'index.html',type:'text/html; charset=utf-8'},
  '/app.js':{file:'app.js',type:'text/javascript; charset=utf-8'},
  '/crypto.js':{file:'crypto.js',type:'text/javascript; charset=utf-8'},
  '/style.css':{file:'style.css',type:'text/css; charset=utf-8'},
};
export async function readRoute(req:IncomingMessage,res:ServerResponse,options:ReadApiOptions):Promise<boolean> {
  if(req.method!=='GET') return false;
  let url:URL;
  try { url=new URL(req.url??'/','http://localhost'); } catch { json(res,400,{error:'INVALID_URL'}); return true; }
  const asset=assets[url.pathname];
  if(asset) {
    try {
      const content=await readFile(join(resolve(options.webDirectory),asset.file));
      const node=options.rpc.network==='mainnet'?'https://rpc.mainnet.fastnear.com https://helper.mainnet.near.org':'https://rpc.testnet.fastnear.com https://helper.testnet.near.org';
      res.writeHead(200,{'content-type':asset.type,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${node}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`}).end(content);
    } catch { json(res,503,{error:'WEB_BUILD_UNAVAILABLE'}); }
    return true;
  }
  if(!url.pathname.startsWith('/v1/')) return false;
  try {
    if(url.pathname==='/v1/meta') {
      const snapshot=await options.rpc.snapshot();
      const config=object(await options.rpc.view(options.contract,'get_config',{},snapshot),'contract config');
      if(config.network!==options.rpc.network||config.protocol_version!=='1'||typeof config.claim_storage_deposit!=='string'||amount(config.claim_storage_deposit)<=0n) throw new Error('Contract config mismatch');
      json(res,200,{network:options.rpc.network,contract:options.contract,signing_public_key:options.signingPublicKey,attestation_hash:options.attestationHash,trust_mode:options.trustMode,confidential_inference_verified:false,claim_storage_deposit:config.claim_storage_deposit,allow_mainnet_writes:options.allowMainnetWrites}); return true;
    }
    if(url.pathname==='/v1/programs') {
      const from=u64(url.searchParams.get('from_index')??'0','pagination index');
      const snapshot=await options.rpc.snapshot();
      const entries=await options.rpc.view(options.contract,'get_bounties',{from_index:from,limit:50},snapshot);
      json(res,200,entries); return true;
    }
    const program=/^\/v1\/programs\/(0|[1-9][0-9]{0,19})$/.exec(url.pathname);
    if(program) {
      const id=u64(program[1],'bounty'),snapshot=await options.rpc.snapshot();
      const bounty=await getProgram(options.rpc,options.contract,id,snapshot);
      if(bounty.verifier.public_key!==options.signingPublicKey||bounty.verifier.encryption_key!==options.encryptionPublicKey||bounty.verifier.attestation_hash!==options.attestationHash) {
        json(res,409,{error:'PROGRAM_USES_ANOTHER_VERIFIER'}); return true;
      }
      const bytes=await readFile(join(resolve(options.configDirectory),bounty.rules_hash+'.json'));
      if(bytes.length>131072) throw new Error('Config too large');
      const config=targetConfig(JSON.parse(bytes.toString('utf8')));
      if(rulesHash(config)!==bounty.rules_hash) throw new Error('Config mismatch');
      json(res,200,{id,bounty,config,finalized_height:snapshot.height.toString()}); return true;
    }
    if(!authorized(req,options.token)) { json(res,401,{error:'UNAUTHORIZED'}); return true; }
    if(url.pathname==='/v1/commitments') {
      const report={bounty:u64(url.searchParams.get('bounty'),'bounty'),hunter:accountId(url.searchParams.get('hunter')),submission:hex(url.searchParams.get('submission'),'submission')};
      const snapshot=await options.rpc.snapshot();
      const claim=await getCommitment(options.rpc,options.contract,report,snapshot);
      json(res,200,{report_hash:claim.report_hash,settled:claim.settled,finalized_height:snapshot.height.toString()}); return true;
    }
    const job=/^\/v1\/jobs\/([a-f0-9]{64})$/.exec(url.pathname);
    if(job) {
      const record=await options.store.get(job[1]!);
      if(!record) { json(res,404,{error:'JOB_NOT_FOUND'}); return true; }
      json(res,200,{id:record.id,state:record.state,transaction:record.transaction,errorCode:record.errorCode,verdict:record.prepared?.verdict,signature:record.prepared?.signature,createdAt:record.createdAt,updatedAt:record.updatedAt}); return true;
    }
    const disclosure=/^\/v1\/disclosures\/([a-f0-9]{64})$/.exec(url.pathname);
    if(disclosure) {
      const ciphertext=await options.disclosure.read(disclosure[1]!);
      res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff'}).end(ciphertext); return true;
    }
    return false;
  } catch(error) {
    json(res,(error as NodeJS.ErrnoException).code==='ENOENT'?404:503,{error:'READ_UNAVAILABLE'}); return true;
  }
}
