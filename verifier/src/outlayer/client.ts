import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { canonical, type TargetConfig } from '../../../protocol/index.ts';
import { storeReport } from '../job-store.ts';
import type { SealedReport } from '../interfaces.ts';
import { NonRetryablePrepareError } from '../jobs.ts';

const execFileAsync=promisify(execFile);
type JsonObject=Record<string,unknown>;
type Network='mainnet'|'testnet';
export interface OutLayerExecution {
  callId:string;
  output:unknown;
  evidenceFile:string;
  verification:JsonObject;
}

function object(value:unknown,label:string):JsonObject {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error(`Invalid OutLayer ${label}`);
  return value as JsonObject;
}
function passed(value:unknown):boolean {
  return !!value&&typeof value==='object'&&(value as JsonObject).verdict==='pass';
}
async function readJson(response:Response,maxBytes:number):Promise<unknown> {
  const reader=response.body?.getReader(); if(!reader) throw new Error('Empty OutLayer response');
  const chunks:Uint8Array[]=[]; let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.length; if(size>maxBytes) throw new Error('OutLayer response too large'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(()=>{}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid OutLayer JSON response'); }
}

export class OutLayerClient {
  private readonly baseUrl:string;
  private readonly project:string;
  private readonly versionHash:string;
  private readonly paymentKey:string;
  private readonly verifyBin:string;
  private readonly evidenceDirectory:string;
  private readonly network:Network;
  private readonly sealedState:string|undefined;
  private readonly secretsRef:{account_id:string;profile:string}|undefined;
  constructor(options:{network:Network;project:string;versionHash:string;paymentKey:string;verifyBin?:string;evidenceDirectory?:string;sealedState?:string;secretsAccount?:string;secretsProfile?:string}) {
    if(!['mainnet','testnet'].includes(options.network)) throw new Error('Invalid OutLayer network');
    this.network=options.network;
    this.sealedState=options.sealedState;
    if(!!options.secretsAccount!==!!options.secretsProfile) throw new Error('OutLayer secrets account and profile must be configured together');
    this.secretsRef=options.secretsAccount&&options.secretsProfile?{account_id:options.secretsAccount,profile:options.secretsProfile}:undefined;
    this.baseUrl=options.network==='mainnet'?'https://api.outlayer.ai':'https://testnet-api.outlayer.ai';
    if(!/^[a-z0-9._-]{2,64}\/[a-z0-9][a-z0-9_-]{0,63}$/.test(options.project)) throw new Error('Invalid OutLayer project id');
    if(!/^[0-9a-f]{64}$/i.test(options.versionHash)) throw new Error('OUTLAYER_VERSION_HASH must be a SHA-256 hex digest');
    if(!/^[a-z0-9._-]{2,64}:[0-9]+:[A-Za-z0-9_-]{16,}$/.test(options.paymentKey)) throw new Error('Invalid OutLayer payment key format');
    this.project=options.project; this.versionHash=options.versionHash.toLowerCase();
    this.paymentKey=options.paymentKey; this.verifyBin=options.verifyBin||'outlayer-verify';
    this.evidenceDirectory=resolve(options.evidenceDirectory||'.evidence/outlayer');
  }
  async executeSealed(report:SealedReport,config:TargetConfig,checkpoint?:{callId?:string;accepted(callId:string):Promise<void>}):Promise<OutLayerExecution> {
    if(report.network!==this.network) throw new Error('OutLayer report network mismatch');
    if(!this.sealedState) throw new Error('OutLayer runner requires provisioned sealed state');
    return this.execute({action:'verify',report:storeReport(report),config,sealed_state:this.sealedState},checkpoint);
  }
  async provision():Promise<OutLayerExecution> { return this.execute({action:'provision'}); }
  private async execute(input:JsonObject,checkpoint?:{callId?:string;accepted(callId:string):Promise<void>}):Promise<OutLayerExecution> {
    const request={input,async:true,version_key:this.versionHash,...(this.secretsRef?{secrets_ref:this.secretsRef}:{}),resource_limits:{max_instructions:100_000_000_000,max_memory_mb:512,max_execution_seconds:180}};
    let result:JsonObject={status:'pending'};
    let callId=checkpoint?.callId;
    if(!callId) {
      let response:Response;
      try { response=await fetch(`${this.baseUrl}/call/${this.project}`,{
        method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
        headers:{'Content-Type':'application/json','X-Payment-Key':this.paymentKey,'X-Compute-Limit':'100000'},
        body:JSON.stringify(request),
      }); } catch { throw new NonRetryablePrepareError('OutLayer call submission outcome is unknown; reconcile manually'); }
      try { result=object(await readJson(response,1_500_000),'call response'); }
      catch { throw new NonRetryablePrepareError('OutLayer call response is unreadable; reconcile manually'); }
      if(!response.ok) throw new NonRetryablePrepareError(`OutLayer call returned HTTP ${response.status}; reconcile before retry`);
      callId=result.call_id as string;
      if(typeof callId!=='string'||!/^[0-9a-f-]{36}$/i.test(callId)||typeof result.attestation_url!=='string') throw new NonRetryablePrepareError('OutLayer call identity is unavailable; reconcile manually');
      const attestationUrl=new URL(result.attestation_url,this.baseUrl);
      if(attestationUrl.origin!==this.baseUrl||attestationUrl.pathname!==`/attestations/by-call/${callId}`) throw new NonRetryablePrepareError('Unexpected OutLayer attestation URL');
      try { await checkpoint?.accepted(callId); }
      catch { throw new NonRetryablePrepareError(`OutLayer call ${callId} was accepted but its checkpoint could not be saved`); }
    }
    if(!/^[0-9a-f-]{36}$/i.test(callId)) throw new NonRetryablePrepareError('Invalid stored OutLayer call ID');
    if(result.status==='pending') {
      const deadline=Date.now()+195_000;
      do {
        await new Promise(resolveWait=>setTimeout(resolveWait,1500));
        let polled:Response;
        try { polled=await fetch(`${this.baseUrl}/calls/${callId}`,{headers:{'X-Payment-Key':this.paymentKey},redirect:'error',signal:AbortSignal.timeout(15_000)}); }
        catch { if(Date.now()<deadline) continue; throw new Error(`OutLayer call ${callId} polling timed out`); }
        if(!polled.ok) {
          await polled.body?.cancel().catch(()=>{});
          if([404,429,500,503].includes(polled.status)&&Date.now()<deadline) continue;
          throw new NonRetryablePrepareError(`OutLayer call ${callId} poll returned HTTP ${polled.status}; reconcile manually`);
        }
        try { result=object(await readJson(polled,1_500_000),'poll response'); }
        catch { if(Date.now()<deadline) continue; throw new Error(`OutLayer call ${callId} poll is unreadable`); }
        if(result.call_id!==callId) throw new NonRetryablePrepareError('OutLayer poll returned another call');
      } while(result.status==='pending'&&Date.now()<deadline);
    }
    if(result.status==='pending') throw checkpoint?new Error(`OutLayer call ${callId} is still pending`):new NonRetryablePrepareError(`OutLayer call ${callId} is still pending; reconcile manually`);
    if(result.status!=='completed'||!('output' in result)) throw new NonRetryablePrepareError(`OutLayer call ${callId} did not complete; reconcile manually`);

    const directory=await mkdtemp(join(tmpdir(),'sealed-bounty-outlayer-'));
    try {
      const inputPath=join(directory,'input.json'), outputPath=join(directory,'output.json'), temporaryBundle=join(directory,'proof.json');
      await writeFile(inputPath,JSON.stringify(input),{mode:0o600,flag:'wx'});
      await writeFile(outputPath,JSON.stringify(result.output),{mode:0o600,flag:'wx'});
      let stdout:string;
      try {
        ({stdout}=await execFileAsync(this.verifyBin,['call',callId,'--network',this.network,'--api',this.baseUrl,'--input',inputPath,'--output',outputPath,'--json','--bundle',temporaryBundle],{timeout:120_000,maxBuffer:2_000_000,encoding:'utf8'}));
      } catch { throw new Error('OutLayer execution proof could not be verified'); }
      const proof=object(JSON.parse(stdout),'verification result');
      if(!passed(proof.authenticity)||!passed(proof.identity)||!passed(proof.binding)||!passed(proof.input)||!passed(proof.output)) throw new Error('OutLayer execution proof did not pass every verification layer');
      const bundle=object(JSON.parse(await readFile(temporaryBundle,'utf8')),'evidence bundle');
      const attestation=object(bundle.attestation,'bundled attestation');
      if(bundle.bundle_format!==1||bundle.network!==this.network||canonical(bundle.input)!==canonical(input)||canonical(bundle.output)!==canonical(result.output)) throw new Error('OutLayer proof bundle payload mismatch');
      if(attestation.wasm_hash!==this.versionHash||attestation.project_id!==this.project||attestation.call_id!==callId) throw new Error('OutLayer proof build/project/call mismatch');
      if(proof.format!=='V1'||!Array.isArray(proof.uncovered_fields)&&proof.uncovered_fields!==undefined||Array.isArray(proof.uncovered_fields)&&proof.uncovered_fields.length>0) throw new Error('OutLayer proof does not bind all identity fields');
      await mkdir(this.evidenceDirectory,{recursive:true,mode:0o700});
      const evidenceFile=join(this.evidenceDirectory,callId+'.json');
      await rename(temporaryBundle,evidenceFile);
      await rm(directory,{recursive:true,force:true});
      return {callId,output:result.output,evidenceFile,verification:proof};
    } catch(error) {
      await rm(directory,{recursive:true,force:true}); throw new NonRetryablePrepareError(error instanceof Error?error.message:'OutLayer proof processing failed');
    }
  }
}
