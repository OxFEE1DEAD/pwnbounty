import { canonical, digest, openDisclosure, randomHex, sealReport, unbase64, verifyVerdict, type Context, type SealedReport } from './crypto.js';
import { HunterWallet } from './wallet.js';

interface Meta {network:'mainnet'|'testnet';contract:string;signing_public_key:string;trust_mode:string;confidential_inference_verified:boolean;claim_storage_deposit:string;allow_mainnet_writes:boolean}
interface Bounty {owner:string;reward:string;state:string;rules_hash:string;expires:string;settle_until:string;verifier:{public_key:string;encryption_key:string;attestation_hash:string}}
interface Entry {id:string;bounty:Bounty}
interface Program extends Entry {config:unknown;finalized_height?:string}
interface Verdict extends Context {valid:boolean;disclosure_hash:string;rules_hash:string;report_hash:string;expires:string}
interface Job {id:string;state:string;transaction?:string;errorCode?:string;verdict?:Verdict;signature?:string}
const element=<T extends HTMLElement>(id:string)=>{const found=document.getElementById(id);if(!found)throw new Error('Missing UI element '+id);return found as T;};
const input=(id:string)=>element<HTMLInputElement>(id);
const text=(id:string)=>element<HTMLTextAreaElement>(id);
let meta:Meta,wallet:HunterWallet,selected:Program|undefined,report:SealedReport|undefined,pollVersion=0,page=0n,reportVersion=0,selectionVersion=0,walletBusy=false;
const pendingKey='sealed-bounty/encrypted-pending/1';
function persistReport():void {
  if(!report)throw new Error('Сначала зашифруйте заявку');
  try{sessionStorage.setItem(pendingKey,JSON.stringify(report));}catch{throw new Error('Браузер запретил sessionStorage. Скачайте JSON и используйте CLI commit.');}
}
function restoreReport(raw:string|null):void {
  if(!raw)return;
  try{
    if(raw.length>1_500_000)throw new Error('Report слишком большой');
    const value=JSON.parse(raw) as Record<string,unknown>,c=context(value);
    if(c.network!==meta.network||c.contract!==meta.contract||typeof value.report_hash!=='string'||!/^[a-f0-9]{64}$/.test(value.report_hash)||typeof value.ciphertext!=='string'||unbase64(value.ciphertext).length<93)throw new Error('Неверный pending report');
    report={...c,report_hash:value.report_hash,ciphertext:value.ciphertext};input('hunter').value=c.hunter;element('sealed-actions').hidden=false;input('committed').checked=false;
    try{sessionStorage.setItem(pendingKey,JSON.stringify(report));}catch{}
    message('Зашифрованная заявка восстановлена. Введите токен и проверьте commitment в NEAR.');
  }catch{sessionStorage.removeItem(pendingKey);message('Сохранённая заявка не подходит этой сети или повреждена.',true);}
}

function message(value:string,error=false):void {
  const status=element('message');status.textContent=value;status.classList.toggle('error',error);status.style.display='block';
}
function run(action:()=>Promise<void>):void {void action().catch(error=>message(error instanceof Error?error.message:'Не удалось выполнить действие',true));}
function headers(auth=false):Headers {
  const headers=new Headers();
  if(auth){const token=input('token').value;if(!token)throw new Error('Введите токен доступа к worker');headers.set('authorization','Bearer '+token);}
  return headers;
}
async function request<T>(path:string,options:RequestInit={},auth=false):Promise<T> {
  const response=await fetch(path,{...options,headers:options.headers??headers(auth),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok){
    const labels:Record<number,string>={400:'Неверный запрос или commitment ещё недоступен в finalized-состоянии',401:'Неверный токен доступа',404:'Запись не найдена',409:'Эта программа использует другой verifier',503:'Worker временно не может прочитать данные'};
    throw new Error(labels[response.status]??`Worker вернул HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
function near(value:string):string {
  try{const n=BigInt(value),whole=n/10n**24n,fraction=(n%10n**24n).toString().padStart(24,'0').replace(/0+$/,'').slice(0,5);return whole.toString()+(fraction?'.'+fraction:'')+' NEAR';}catch{return value+' yoctoNEAR';}
}
async function chainBounty(id:string):Promise<Bounty> {
  const query={request_type:'call_function',finality:'final',account_id:meta.contract,method_name:'get_bounty',args_base64:btoa(JSON.stringify({bounty:id}))};
  const response=await fetch(`https://rpc.${meta.network}.fastnear.com`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'sealed-bounty',method:'query',params:query}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  const body=await response.json() as {result?:{result?:number[]}};
  if(!response.ok||!Array.isArray(body.result?.result))throw new Error('NEAR RPC не вернул программу');
  const bounty=JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as Bounty|null;
  if(!bounty)throw new Error('Программа не найдена в контракте');
  return bounty;
}
function invalidateReport():void {reportVersion++;report=undefined;try{sessionStorage.removeItem(pendingKey);}catch{}element('sealed-actions').hidden=true;input('committed').checked=false;}
async function select(entry:Entry,button:HTMLButtonElement):Promise<void> {
  const version=++selectionVersion;invalidateReport();selected=undefined;element<HTMLButtonElement>('seal').disabled=true;
  const program=await request<Program>('/v1/programs/'+encodeURIComponent(String(entry.id)));
  const onchain=await chainBounty(String(entry.id));
  if(await digest(canonical(program.config))!==onchain.rules_hash)throw new Error('Hash конфигурации не совпадает с программой');
  if(onchain.verifier.public_key!==meta.signing_public_key)throw new Error('Signer программы в контракте отличается от worker');
  program.bounty=onchain;
  if(version!==selectionVersion)return;selected=program;
  for(const card of document.querySelectorAll('.program'))card.classList.remove('selected');button.classList.add('selected');
  const rules=element('rules');rules.hidden=false;rules.textContent=JSON.stringify({bounty:program.id,owner:program.bounty.owner,reward:near(program.bounty.reward),state:program.bounty.state,rules_hash:program.bounty.rules_hash,expires:program.bounty.expires,settle_until:program.bounty.settle_until,config:program.config},null,2);
  const canCommit=program.bounty.state==='Available'&&(!program.finalized_height||BigInt(program.finalized_height)<BigInt(program.bounty.expires));
  element<HTMLButtonElement>('seal').disabled=!canCommit;
  message(canCommit?'Программа выбрана. Подготовьте инвойс.':'Программа закрыта для новых commitments.',!canCommit);
}
async function programs(reset:boolean):Promise<void> {
  if(reset){selectionVersion++;page=0n;selected=undefined;invalidateReport();element('rules').hidden=true;element<HTMLButtonElement>('seal').disabled=true;element('programs').replaceChildren();}
  const entries=await request<Entry[]>('/v1/programs?from_index='+page);
  if(!Array.isArray(entries))throw new Error('Неверный каталог программ');
  for(const entry of entries){
    const button=document.createElement('button');button.type='button';button.className='program';
    const title=document.createElement('strong');title.textContent='Программа #'+String(entry.id);
    const reward=document.createElement('span');reward.textContent=near(entry.bounty.reward);
    const owner=document.createElement('span');owner.textContent=entry.bounty.owner;
    const state=document.createElement('span');state.textContent=entry.bounty.state;
    button.append(title,reward,owner,state);button.addEventListener('click',()=>run(()=>select(entry,button)));element('programs').append(button);
  }
  page+=50n;element('more').hidden=entries.length<50;
  if(reset&&!entries.length)element('programs').textContent='Профинансированных программ пока нет.';
}
function context(value:unknown):Context {
  if(!value||typeof value!=='object')throw new Error('Неверный контекст');
  const c=value as Record<string,unknown>;
  for(const field of ['network','contract','bounty','hunter','submission'])if(typeof c[field]!=='string')throw new Error('Неверное поле контекста '+field);
  if(!['testnet','mainnet'].includes(c.network as string)||!/^(0|[1-9][0-9]{0,19})$/.test(c.bounty as string)||BigInt(c.bounty as string)>(1n<<64n)-1n||!/^[a-f0-9]{64}$/.test(c.submission as string))throw new Error('Неверные network/bounty/submission');
  for(const account of [c.contract,c.hunter])if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account as string)||(account as string).length<2||(account as string).length>64)throw new Error('Неверный аккаунт контекста');
  return {network:c.network as string,contract:c.contract as string,bounty:c.bounty as string,hunter:c.hunter as string,submission:c.submission as string};
}
async function track(id:string,version:number):Promise<void> {
  if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Job ID должен содержать 64 hex-символа');
  const job=await request<Job>('/v1/jobs/'+id,{},true);
  if(version!==pollVersion)return;
  element('job').textContent=JSON.stringify(job,null,2);
  const link=element<HTMLAnchorElement>('receipt');link.hidden=true;
  const tx=job.transaction?.match(/^near:(testnet|mainnet):transaction:([1-9A-HJ-NP-Za-km-z]+)$/);
  if(tx){link.href=`https://${tx[1]==='testnet'?'testnet.':''}nearblocks.io/txns/${tx[2]}`;link.hidden=false;}
  if(job.verdict){
    if(job.verdict.network!==meta.network||job.verdict.contract!==meta.contract||typeof job.signature!=='string'||!await verifyVerdict(job.verdict,job.signature,(await chainBounty(job.verdict.bounty)).verifier.public_key))throw new Error('Подпись verdict не прошла проверку');
    if(version!==pollVersion)return;
    input('disclosure-hash').value=job.verdict.disclosure_hash;text('context').value=JSON.stringify(context(job.verdict),null,2);
  }
  if(job.state==='complete')message('Verdict принят. Фактическое поступление награды проверьте по receipt и балансу.');
  else if(job.state==='failed')message('Обработка остановлена: '+(job.errorCode??'ошибка worker'),true);
  else window.setTimeout(()=>{if(version===pollVersion)run(()=>track(id,version));},3000);
}

element('refresh').addEventListener('click',()=>run(()=>programs(true)));
element('more').addEventListener('click',()=>run(()=>programs(false)));
element('connect-wallet').addEventListener('click',()=>run(async()=>{
  if(!wallet)throw new Error('Дождитесь загрузки worker');
  if(report)persistReport();
  const account=await wallet.connect();
  if(account){element('wallet-account').textContent='Кошелёк: '+account;if(!report){input('hunter').value=account;invalidateReport();}else if(report.hunter!==account)throw new Error('Кошелёк отличается от hunter сохранённой заявки. Подключите нужный аккаунт.');}
}));
async function checkCommitment():Promise<void> {
  const pending=report;if(!pending)throw new Error('Заявка ещё не подготовлена');
  const query=new URLSearchParams({bounty:pending.bounty,hunter:pending.hunter,submission:pending.submission});
  const claim=await request<{report_hash:string;settled:boolean;finalized_height:string}>('/v1/commitments?'+query,{},true);
  if(report!==pending)throw new Error('Заявка изменилась во время проверки');
  if(claim.report_hash!==pending.report_hash||claim.settled)throw new Error('Commitment отсутствует, отличается от заявки или уже обработан');
  input('committed').checked=true;message('Commitment подтверждён на finalized-блоке '+claim.finalized_height+'. Можно отправить ciphertext.');
}
element('check-commitment').addEventListener('click',()=>run(checkCommitment));
element('wallet-commit').addEventListener('click',()=>run(async()=>{
  if(walletBusy)throw new Error('Подтверждение кошелька уже ожидается');
  if(!report)throw new Error('Сначала зашифруйте заявку');
  const pending=report;persistReport();
  message('Подтвердите commit в кошельке. Сохранён только зашифрованный report.');
  walletBusy=true;element<HTMLButtonElement>('wallet-commit').disabled=true;
  try{await wallet.commit(pending,meta.claim_storage_deposit);if(report===pending)await checkCommitment();}
  finally{walletBusy=false;element<HTMLButtonElement>('wallet-commit').disabled=false;}
}));
input('hunter').addEventListener('input',invalidateReport);
text('attack').addEventListener('input',invalidateReport);
element('seal-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  if(!selected)throw new Error('Выберите программу');
  const hunter=input('hunter').value.trim();
  const c=context({network:meta.network,contract:meta.contract,bounty:String(selected.id),hunter,submission:randomHex()});
  const version=++reportVersion;
  const button=element<HTMLButtonElement>('seal');button.disabled=true;
  try{
    const sealed=await sealReport(c,text('attack').value,selected.bounty.verifier.encryption_key);
    if(version!==reportVersion)return;
    report=sealed;
    text('attack').value='';element('sealed-actions').hidden=false;input('committed').checked=false;
    try{persistReport();}catch{message('Заявка зашифрована, но sessionStorage недоступен. Скачайте JSON и используйте CLI commit.',true);return;}
    message('Заявка зашифрована. Подпишите commit кошельком или скачайте JSON для CLI.');
  }catch{throw new Error('Не удалось зашифровать заявку. Проверьте поддержку WebCrypto X25519, HTTPS/localhost и размер инвойса.');}
  finally{button.disabled=!selected||selected.bounty.state!=='Available';}
});});
element('download').addEventListener('click',()=>{
  if(!report)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='sealed-report.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
});
element('submit').addEventListener('click',()=>run(async()=>{
  await checkCommitment();
  if(!report)throw new Error('Заявка изменилась');
  const h=headers(true);h.set('content-type','application/json');
  const job=await request<{id:string}>('/v1/submissions',{method:'POST',headers:h,body:JSON.stringify(report)},true);
  input('job-id').value=job.id;await track(job.id,++pollVersion);
}));
element('track').addEventListener('click',()=>run(()=>track(input('job-id').value.trim(),++pollVersion)));
element('decrypt-form').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const hash=input('disclosure-hash').value.trim();if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Неверный disclosure hash');
  const file=input('team-key').files?.[0];if(!file||file.size>4096)throw new Error('Выберите PKCS8 DER private key команды');
  const c=context(JSON.parse(text('context').value));
  const response=await fetch('/v1/disclosures/'+hash,{headers:headers(true),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Не удалось получить ciphertext: HTTP '+response.status);
  const ciphertext=await readLimited(response,1_048_576);
  if(ciphertext.length>1_048_576||await digest(ciphertext)!==hash)throw new Error('Хеш ciphertext не совпадает');
  let plain:string;
  try{plain=await openDisclosure(ciphertext,await file.arrayBuffer(),c);}catch{throw new Error('Расшифровка не прошла: проверьте ключ, контекст и поддержку X25519');}
  element('disclosure').textContent=plain;element('disclosure').hidden=false;element('clear-disclosure').hidden=false;input('team-key').value='';
  message('Раскрытие расшифровано локально.');
});});
async function readLimited(response:Response,max:number):Promise<Uint8Array> {
  const reader=response.body?.getReader();if(!reader)throw new Error('Пустой ciphertext');
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw new Error('Ciphertext превышает лимит');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
element('clear-disclosure').addEventListener('click',()=>{element('disclosure').textContent='';element('disclosure').hidden=true;element('clear-disclosure').hidden=true;input('team-key').value='';});
window.addEventListener('pagehide',()=>{pollVersion++;input('token').value='';text('attack').value='';element('disclosure').textContent='';report=undefined;});
run(async()=>{
  meta=await request<Meta>('/v1/meta');
  if(!['testnet','mainnet'].includes(meta.network))throw new Error('Неверная сеть worker');
  wallet=new HunterWallet(meta.network,meta.contract,meta.allow_mainnet_writes===true);
  let pending:string|null=null;try{pending=sessionStorage.getItem(pendingKey);}catch{}
  element('trust').textContent=meta.trust_mode==='local-development'?'Локальный development verifier. TEE и приватность модели не подтверждены.':`Worker: ${meta.trust_mode}. Конфиденциальность inference ${meta.confidential_inference_verified?'подтверждена worker':'пока не подтверждена'}. Перед приватной заявкой проверьте evidence.`;
  await programs(true);
  restoreReport(pending);
  const account=await wallet.account();
  if(account){element('wallet-account').textContent='Кошелёк: '+account;if(!report)input('hunter').value=account;}
});
