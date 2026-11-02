import { canonical, digest, openDisclosure, randomHex, sealReport, unbase64, verifyVerdict, type Context, type SealedReport } from './crypto.js';
import { HunterWallet } from './wallet.js';
import { settlementState, type ChainCommitment } from './settlement.js';
import { applyLanguage, show, toggleLanguage } from './i18n.js';

interface Meta {network:'mainnet'|'testnet';contract:string;signing_public_key:string;trust_mode:string;confidential_inference_verified:boolean;claim_storage_deposit:string;min_prepare_window_blocks:string;allow_mainnet_writes:boolean}
interface Bounty {owner:string;reward:string;state:string;winner:string|null;rules_hash:string;expires:string;settle_until:string;verifier:{public_key:string;encryption_key:string;attestation_hash:string}}
interface Entry {id:string;bounty:Bounty}
interface Program extends Entry {config:unknown;finalized_height?:string}
interface Verdict extends Context {version:string;valid:boolean;disclosure_hash:string;rules_hash:string;report_hash:string;expires:string}
interface Job {id:string;state:string;transaction?:string;errorCode?:string;outlayerCallId?:string;verdict?:Verdict;signature?:string}
const element=<T extends HTMLElement>(id:string)=>{const found=document.getElementById(id);if(!found)throw new Error('Missing UI element '+id);return found as T;};
const input=(id:string)=>element<HTMLInputElement>(id);
const text=(id:string)=>element<HTMLTextAreaElement>(id);
let meta:Meta,wallet:HunterWallet,selected:Program|undefined,report:SealedReport|undefined,pollVersion=0,page=0n,reportVersion=0,selectionVersion=0,walletBusy=false;
const pendingKey='sealed-bounty/encrypted-pending/1';
const pendingJobKey='sealed-bounty/job-id/1';
function persistReport():void {
  if(!report)throw new Error('Encrypt the submission first');
  try{sessionStorage.setItem(pendingKey,JSON.stringify(report));}catch{throw new Error('The browser blocked sessionStorage. Download the JSON and use CLI commit.');}
}
function restoreReport(raw:string|null):void {
  if(!raw)return;
  try{
    if(raw.length>1_500_000)throw new Error('Report too large');
    const value=JSON.parse(raw) as Record<string,unknown>,c=context(value);
    if(c.network!==meta.network||c.contract!==meta.contract||typeof value.report_hash!=='string'||!/^[a-f0-9]{64}$/.test(value.report_hash)||typeof value.ciphertext!=='string'||unbase64(value.ciphertext).length<93)throw new Error('Invalid pending report');
    report={...c,report_hash:value.report_hash,ciphertext:value.ciphertext};input('hunter').value=c.hunter;element('sealed-actions').hidden=false;input('committed').checked=false;
    try{sessionStorage.setItem(pendingKey,JSON.stringify(report));}catch{}
    message('Encrypted submission restored. Enter the token and check the commitment on NEAR.');
  }catch{sessionStorage.removeItem(pendingKey);message('The saved submission does not match this network or is corrupted.',true);}
}

function message(value:string,error=false):void {
  const status=element('message');show(status,value);status.classList.toggle('error',error);status.style.display='block';
}
function run(action:()=>Promise<void>):void {void action().catch(error=>message(error instanceof Error?error.message:'Action failed',true));}
function headers(auth=false):Headers {
  const headers=new Headers();
  if(auth){const token=input('token').value;if(!token)throw new Error('Enter the worker access token');headers.set('authorization','Bearer '+token);}
  return headers;
}
async function request<T>(path:string,options:RequestInit={},auth=false):Promise<T> {
  const response=await fetch(path,{...options,headers:options.headers??headers(auth),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){
    const labels:Record<number,string>={400:'Bad request or the commitment is not finalized yet',401:'Invalid access token',404:'Record not found',409:'This program uses a different verifier',503:'The worker cannot read the data right now'};
    throw new Error(labels[response.status]??`Worker returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
function near(value:string):string {
  try{const n=BigInt(value),whole=n/10n**24n,fraction=(n%10n**24n).toString().padStart(24,'0').replace(/0+$/,'').slice(0,5);return whole.toString()+(fraction?'.'+fraction:'')+' NEAR';}catch{return value+' yoctoNEAR';}
}
async function chainView<T>(method:string,args:Record<string,string>,blockHash?:string):Promise<{value:T|null;blockHash:string}> {
  const query={request_type:'call_function',account_id:meta.contract,method_name:method,args_base64:btoa(JSON.stringify(args)),...(blockHash?{block_id:blockHash}:{finality:'final'})};
  const response=await fetch(`https://rpc.${meta.network}.fastnear.com`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'sealed-bounty',method:'query',params:query}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  const body=JSON.parse(new TextDecoder().decode(await readLimited(response,1_048_576))) as {result?:{result?:number[];block_hash?:string}};
  if(!response.ok||!Array.isArray(body.result?.result)||typeof body.result.block_hash!=='string'||blockHash&&body.result.block_hash!==blockHash)throw new Error('NEAR RPC returned an inconsistent contract state');
  return {value:JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T|null,blockHash:body.result.block_hash};
}
async function chainBounty(id:string,blockHash?:string):Promise<Bounty> {
  const {value:bounty}=await chainView<Bounty>('get_bounty',{bounty:id},blockHash);
  if(!bounty)throw new Error('Program not found in the contract');
  return bounty;
}
async function chainCommitment(v:Verdict):Promise<{value:ChainCommitment|null;blockHash:string}> {
  return chainView<ChainCommitment>('get_commitment',{bounty:v.bounty,hunter:v.hunter,submission:v.submission});
}
function invalidateReport():void {reportVersion++;report=undefined;try{sessionStorage.removeItem(pendingKey);}catch{}element('sealed-actions').hidden=true;input('committed').checked=false;}
async function select(entry:Entry,button:HTMLButtonElement):Promise<void> {
  const version=++selectionVersion;invalidateReport();selected=undefined;element<HTMLButtonElement>('seal').disabled=true;
  const program=await request<Program>('/v1/programs/'+encodeURIComponent(String(entry.id)));
  const onchain=await chainBounty(String(entry.id));
  if(await digest(canonical(program.config))!==onchain.rules_hash)throw new Error('Config hash does not match the program');
  if(onchain.verifier.public_key!==meta.signing_public_key)throw new Error('The program signer in the contract differs from the worker');
  program.bounty=onchain;
  if(version!==selectionVersion)return;selected=program;
  for(const card of document.querySelectorAll('.program'))card.classList.remove('selected');button.classList.add('selected');
  const rules=element('rules');rules.hidden=false;rules.textContent=JSON.stringify({bounty:program.id,owner:program.bounty.owner,reward:near(program.bounty.reward),state:program.bounty.state,rules_hash:program.bounty.rules_hash,expires:program.bounty.expires,settle_until:program.bounty.settle_until,config:program.config},null,2);
  const canCommit=program.bounty.state==='Available'&&!!program.finalized_height&&BigInt(program.finalized_height)<BigInt(program.bounty.expires)
    &&BigInt(program.finalized_height)+BigInt(meta.min_prepare_window_blocks)<=BigInt(program.bounty.settle_until);
  element<HTMLButtonElement>('seal').disabled=!canCommit;
  message(canCommit?'Program selected. Prepare the invoice.':'The program is closed for new commitments.',!canCommit);
}
async function programs(reset:boolean):Promise<void> {
  if(reset){selectionVersion++;page=0n;selected=undefined;invalidateReport();element('rules').hidden=true;element<HTMLButtonElement>('seal').disabled=true;delete element('programs').dataset.en;element('programs').replaceChildren();}
  const entries=await request<Entry[]>('/v1/programs?from_index='+page);
  if(!Array.isArray(entries))throw new Error('Invalid program catalog');
  for(const entry of entries){
    const button=document.createElement('button');button.type='button';button.className='program';
    const title=document.createElement('strong');show(title,'Program #'+String(entry.id));
    const reward=document.createElement('span');reward.textContent=near(entry.bounty.reward);
    const owner=document.createElement('span');owner.textContent=entry.bounty.owner;
    const state=document.createElement('span');state.textContent=entry.bounty.state;
    button.append(title,reward,owner,state);button.addEventListener('click',()=>run(()=>select(entry,button)));element('programs').append(button);
  }
  page+=50n;element('more').hidden=entries.length<50;
  if(reset&&!entries.length)show(element('programs'),'No funded programs yet.');
}
function context(value:unknown):Context {
  if(!value||typeof value!=='object')throw new Error('Invalid context');
  const c=value as Record<string,unknown>;
  for(const field of ['network','contract','bounty','hunter','submission'])if(typeof c[field]!=='string')throw new Error('Invalid context field '+field);
  if(!['testnet','mainnet'].includes(c.network as string)||!/^(0|[1-9][0-9]{0,19})$/.test(c.bounty as string)||BigInt(c.bounty as string)>(1n<<64n)-1n||!/^[a-f0-9]{64}$/.test(c.submission as string))throw new Error('Invalid network/bounty/submission');
  for(const account of [c.contract,c.hunter])if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account as string)||(account as string).length<2||(account as string).length>64)throw new Error('Invalid context account');
  return {network:c.network as string,contract:c.contract as string,bounty:c.bounty as string,hunter:c.hunter as string,submission:c.submission as string};
}
async function track(id:string,version:number):Promise<void> {
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Job ID must be 64 hex characters');
  input('job-id').value=id;
  try{sessionStorage.setItem(pendingJobKey,id);}catch{}
  const retry=element<HTMLButtonElement>('retry-payment');retry.hidden=true;delete retry.dataset.bounty;delete retry.dataset.hunter;
  const job=await request<Job>('/v1/jobs/'+id,{},true);
  if(version!==pollVersion)return;
  const status=element('job');delete status.dataset.en;status.textContent=JSON.stringify(job,null,2);
  const link=element<HTMLAnchorElement>('receipt');link.hidden=true;
  const tx=job.transaction?.match(/^near:(testnet|mainnet):transaction:([1-9A-HJ-NP-Za-km-z]+)$/);
  if(tx){link.href=`https://${tx[1]==='testnet'?'testnet.':''}nearblocks.io/txns/${tx[2]}`;link.hidden=false;}
  if(job.verdict){
    const {value:claim,blockHash}=await chainCommitment(job.verdict);
    const bounty=await chainBounty(job.verdict.bounty,blockHash);
    if(job.verdict.network!==meta.network||job.verdict.contract!==meta.contract||typeof job.signature!=='string'||!await verifyVerdict(job.verdict,job.signature,bounty.verifier.public_key))throw new Error('Verdict signature check failed');
    if(version!==pollVersion)return;
    input('disclosure-hash').value=job.verdict.disclosure_hash;text('context').value=JSON.stringify(context(job.verdict),null,2);
    if(job.state==='complete'){
      const state=settlementState(job.verdict,claim,bounty);
      if(state==='unconfirmed')message('Transaction sent; waiting for the verdict in finalized NEAR.');
      if(state==='no-reward')message('Verdict accepted on NEAR: no violation confirmed, no reward.');
      if(state==='paid')message('Reward paid to the hunter according to finalized NEAR state.');
      if(state==='retryable'){
        retry.dataset.bounty=job.verdict.bounty;retry.dataset.hunter=job.verdict.hunter;retry.hidden=false;
        message('The reward transfer failed. The winner can retry it with a wallet.',true);
      }
      if(state==='pending')message('Verdict accepted; the reward transfer is waiting for the NEAR callback.');
      if(state==='unconfirmed'||state==='pending')window.setTimeout(()=>{if(version===pollVersion)run(()=>track(id,version));},5000);
      return;
    }
  }
  if(job.state==='complete')throw new Error('A completed job has no signed verdict');
  else if(job.state==='failed')message('Processing stopped: '+(job.errorCode??'worker error')+(job.outlayerCallId?', OutLayer call '+job.outlayerCallId:''),true);
  else window.setTimeout(()=>{if(version===pollVersion)run(()=>track(id,version));},3000);
}

applyLanguage();
element('lang').addEventListener('click',toggleLanguage);
element('refresh').addEventListener('click',()=>run(()=>programs(true)));
element('more').addEventListener('click',()=>run(()=>programs(false)));
element('connect-wallet').addEventListener('click',()=>run(async()=>{
  if(!wallet)throw new Error('Wait for the worker to load');
  if(report)persistReport();
  const account=await wallet.connect();
  if(account){show(element('wallet-account'),'Wallet: '+account);if(!report){input('hunter').value=account;invalidateReport();}else if(report.hunter!==account)throw new Error('The wallet differs from the hunter of the saved submission. Connect the right account.');}
}));
async function checkCommitment():Promise<void> {
  const pending=report;if(!pending)throw new Error('No submission prepared yet');
  const query=new URLSearchParams({bounty:pending.bounty,hunter:pending.hunter,submission:pending.submission});
  const claim=await request<{report_hash:string;settled:boolean;finalized_height:string}>('/v1/commitments?'+query,{},true);
  if(report!==pending)throw new Error('The submission changed during the check');
  if(claim.report_hash!==pending.report_hash||claim.settled)throw new Error('Commitment is missing, differs from the submission or was already processed');
  input('committed').checked=true;message('Commitment confirmed, you can send the ciphertext. Finalized block '+claim.finalized_height);
}
element('check-commitment').addEventListener('click',()=>run(checkCommitment));
element('wallet-commit').addEventListener('click',()=>run(async()=>{
  if(walletBusy)throw new Error('Wallet confirmation is already pending');
  if(!report)throw new Error('Encrypt the submission first');
  const pending=report;persistReport();
  message('Confirm the commit in the wallet. Only the encrypted report is saved.');
  walletBusy=true;element<HTMLButtonElement>('wallet-commit').disabled=true;
  try{await wallet.commit(pending,meta.claim_storage_deposit);if(report===pending)await checkCommitment();}
  finally{walletBusy=false;element<HTMLButtonElement>('wallet-commit').disabled=false;}
}));
input('hunter').addEventListener('input',invalidateReport);
text('attack').addEventListener('input',invalidateReport);
element('seal-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  if(!selected)throw new Error('Choose a program');
  const hunter=input('hunter').value.trim();
  const c=context({network:meta.network,contract:meta.contract,bounty:String(selected.id),hunter,submission:randomHex()});
  const version=++reportVersion;
  const button=element<HTMLButtonElement>('seal');button.disabled=true;
  try{
    const sealed=await sealReport(c,text('attack').value,selected.bounty.verifier.encryption_key);
    if(version!==reportVersion)return;
    report=sealed;
    text('attack').value='';element('sealed-actions').hidden=false;input('committed').checked=false;
    try{persistReport();}catch{message('Submission encrypted, but sessionStorage is unavailable. Download the JSON and use CLI commit.',true);return;}
    message('Submission encrypted. Sign the commit with the wallet or download the JSON for the CLI.');
  }catch{throw new Error('Could not encrypt the submission. Check WebCrypto X25519 support, HTTPS/localhost and the invoice size.');}
  finally{button.disabled=!selected||selected.bounty.state!=='Available';}
});});
element('download').addEventListener('click',()=>{
  if(!report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='sealed-report.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
});
element('submit').addEventListener('click',()=>run(async()=>{
  await checkCommitment();
  if(!report)throw new Error('The submission changed');
  const h=headers(true);h.set('content-type','application/json');
  const job=await request<{id:string}>('/v1/submissions',{method:'POST',headers:h,body:JSON.stringify(report)},true);
  input('job-id').value=job.id;await track(job.id,++pollVersion);
}));
element('track').addEventListener('click',()=>run(()=>track(input('job-id').value.trim(),++pollVersion)));
element('retry-payment').addEventListener('click',()=>run(async()=>{
  if(walletBusy)throw new Error('Wallet confirmation is already pending');
  const button=element<HTMLButtonElement>('retry-payment'),bounty=button.dataset.bounty,hunter=button.dataset.hunter;
  if(button.hidden||!bounty||!hunter)throw new Error('Check the payout state first');
  if(report)persistReport();
  walletBusy=true;button.disabled=true;
  try{await wallet.retryPayment(bounty,hunter);await track(input('job-id').value.trim(),++pollVersion);}
  finally{walletBusy=false;button.disabled=false;}
}));
element('decrypt-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const hash=input('disclosure-hash').value.trim();if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid disclosure hash');
  const file=input('team-key').files?.[0];if(!file||file.size>4096)throw new Error('Choose the team PKCS8 DER private key');
  const c=context(JSON.parse(text('context').value));
  const response=await fetch('/v1/disclosures/'+hash,{headers:headers(true),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Could not fetch ciphertext: HTTP '+response.status);
  const ciphertext=await readLimited(response,1_048_576);
  if(ciphertext.length>1_048_576||await digest(ciphertext)!==hash)throw new Error('Ciphertext hash mismatch');
  let plain:string;
  try{plain=await openDisclosure(ciphertext,await file.arrayBuffer(),c);}catch{throw new Error('Decryption failed: check the key, the context and X25519 support');}
  element('disclosure').textContent=plain;element('disclosure').hidden=false;element('clear-disclosure').hidden=false;input('team-key').value='';
  message('Disclosure decrypted locally.');
});});
async function readLimited(response:Response,max:number):Promise<Uint8Array> {
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty ciphertext');
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw new Error('Ciphertext exceeds the limit');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
element('clear-disclosure').addEventListener('click',()=>{element('disclosure').textContent='';element('disclosure').hidden=true;element('clear-disclosure').hidden=true;input('team-key').value='';});
window.addEventListener('pagehide',()=>{pollVersion++;input('token').value='';text('attack').value='';element('disclosure').textContent='';report=undefined;});
run(async()=>{
  meta=await request<Meta>('/v1/meta');
  if(!['testnet','mainnet'].includes(meta.network))throw new Error('Invalid worker network');
  if(!/^[1-9][0-9]*$/.test(meta.min_prepare_window_blocks))throw new Error('The worker did not report its verification time limit');
  wallet=new HunterWallet(meta.network,meta.contract,meta.allow_mainnet_writes===true);
  let pending:string|null=null;try{pending=sessionStorage.getItem(pendingKey);}catch{}
  try{const jobId=sessionStorage.getItem(pendingJobKey);if(jobId&&/^[a-f0-9]{64}$/.test(jobId))input('job-id').value=jobId;}catch{}
  show(element('trust'),meta.trust_mode==='local-development'?'Local development verifier. TEE and model privacy are not confirmed.':meta.confidential_inference_verified?'OutLayer worker. Inference confidentiality is confirmed by the worker. Check the evidence before a private submission.':'OutLayer worker. Inference confidentiality is not confirmed yet. Check the evidence before a private submission.');
  await programs(true);
  restoreReport(pending);
  const account=await wallet.account();
  if(account){show(element('wallet-account'),'Wallet: '+account);if(!report)input('hunter').value=account;}
});
