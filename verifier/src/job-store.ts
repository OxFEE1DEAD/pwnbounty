import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { canonical, digest, type Verdict } from '../../protocol/index.ts';
import type { SealedReport } from './interfaces.ts';

export interface PreparedJob { verdict: Verdict; signature: Uint8Array; location: string }
export interface StoredReport extends Omit<SealedReport, 'ciphertext'> { ciphertext: string }
export interface StoredPrepared extends Omit<PreparedJob, 'signature'> { signature: string }
export type JobState = 'queued' | 'preparing' | 'prepared' | 'delivering' | 'complete' | 'failed';
export interface JobRecord {
  version: 1;
  id: string;
  report: StoredReport;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  nextAttemptAt: number;
  prepareAttempts: number;
  deliveryAttempts: number;
  externalCallId?: string;
  prepared?: StoredPrepared;
  transaction?: string;
  errorCode?: 'PREPARE_FAILED' | 'DELIVERY_FAILED' | 'ATTEMPTS_EXHAUSTED';
}

export interface JobSummary { id: string; program: string; state: JobState; createdAt: number; updatedAt: number; nextAttemptAt: number }
export const programKey = (r: SealedReport | StoredReport): string => [r.network, r.contract, r.bounty].join(':');
const summary = (r: JobRecord): JobSummary => ({ id:r.id, program:programKey(r.report), state:r.state, createdAt:r.createdAt, updatedAt:r.updatedAt, nextAttemptAt:r.nextAttemptAt });
export const reportId = (r: SealedReport | StoredReport): string => digest(canonical([
  'sealed-bounty/job/1', r.network, r.contract, r.bounty, r.hunter, r.submission,
]));
export function storeReport(report: SealedReport): StoredReport {
  if (report.ciphertext.length < 93 || report.ciphertext.length > 1_048_576) throw new Error('Invalid envelope size');
  const stored: StoredReport = { network:report.network, contract:report.contract, bounty:report.bounty,
    hunter:report.hunter, submission:report.submission, report_hash:report.report_hash,
    ciphertext:Buffer.from(report.ciphertext).toString('base64') };
  validateReport(stored);
  return stored;
}
export const restoreReport = (report: StoredReport): SealedReport => ({
  ...report, ciphertext: Buffer.from(report.ciphertext, 'base64'),
});
export const restorePrepared = (prepared: StoredPrepared): PreparedJob => ({
  ...prepared, signature: Buffer.from(prepared.signature, 'base64'),
});
export function storePrepared(prepared: PreparedJob): StoredPrepared {
  if (prepared.signature.length !== 64 || typeof prepared.location !== 'string' || prepared.location.length > 4096) throw new Error('Invalid prepared job');
  const v=prepared.verdict;
  const verdict: Verdict={version:v.version,network:v.network,contract:v.contract,bounty:v.bounty,
    hunter:v.hunter,submission:v.submission,rules_hash:v.rules_hash,report_hash:v.report_hash,
    valid:v.valid,disclosure_hash:v.disclosure_hash,expires:v.expires};
  return { verdict, location:prepared.location, signature:Buffer.from(prepared.signature).toString('base64') };
}
function validBase64(value: unknown, min: number, max: number): boolean {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value;
}
function validateReport(report: StoredReport): void {
  if (!report || typeof report !== 'object' || !['testnet', 'mainnet', 'local'].includes(report.network)
    || !/^[a-z0-9._-]{2,64}$/.test(report.contract) || !/^[a-z0-9._-]{2,64}$/.test(report.hunter)
    || !/^(0|[1-9][0-9]{0,19})$/.test(report.bounty)
    || BigInt(report.bounty) > (1n << 64n) - 1n
    || !/^[a-f0-9]{64}$/.test(report.submission) || !/^[a-f0-9]{64}$/.test(report.report_hash)
    || !validBase64(report.ciphertext, 93, 1_048_576)) throw new Error('Invalid stored report');
}
function parseRecord(input: unknown, expectedId: string): JobRecord {
  if (!input || typeof input !== 'object') throw new Error('Invalid job record');
  const r = input as JobRecord;
  validateReport(r.report);
  if (r.version !== 1 || r.id !== expectedId || reportId(r.report) !== expectedId
    || !['queued','preparing','prepared','delivering','complete','failed'].includes(r.state)
    || (r.externalCallId !== undefined && (typeof r.externalCallId !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.externalCallId)))
    || ![r.createdAt,r.updatedAt,r.nextAttemptAt,r.prepareAttempts,r.deliveryAttempts].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid job record');
  if (['prepared','delivering','complete'].includes(r.state) && !r.prepared) throw new Error('Missing durable verdict');
  if (r.prepared) {
    const v = r.prepared.verdict;
    if (!v || typeof v !== 'object' || v.version !== '1' || typeof v.valid !== 'boolean'
      || !/^[0-9a-f]{64}$/.test(v.rules_hash) || !/^[0-9a-f]{64}$/.test(v.disclosure_hash)
      || !/^(0|[1-9][0-9]{0,19})$/.test(v.expires)
      || BigInt(v.expires) > (1n << 64n) - 1n
      || !validBase64(r.prepared.signature,64,64) || typeof r.prepared.location !== 'string' || r.prepared.location.length > 4096
      || ['network','contract','bounty','hunter','submission','report_hash'].some(k => v[k as keyof Verdict] !== r.report[k as keyof StoredReport])) throw new Error('Invalid durable verdict');
  }
  if (r.state === 'complete' && (typeof r.transaction !== 'string' || !r.transaction)) throw new Error('Missing settlement receipt');
  return r;
}

export class FileJobStore {
  readonly directory: string;
  private token: string | undefined;
  private locking = false;
  private index: Map<string, JobSummary> | undefined;
  constructor(directory: string) { this.directory = resolve(directory); }
  async acquire(): Promise<void> {
    if (this.token || this.locking) throw new Error('Job store already locked by this instance');
    this.locking = true;
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const token=randomUUID();
      const lock=await open(join(this.directory,'.worker.lock'),'wx',0o600);
      try { await lock.writeFile(JSON.stringify({version:1,token,pid:process.pid,host:hostname()})); await lock.sync(); }
      finally { await lock.close(); }
      this.token=token;
    } finally { this.locking=false; }
  }
  async acquireRecoveringStoppedWorker(): Promise<void> {
    try { await this.acquire(); }
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
      await this.recoverStoppedWorker();
      await this.acquire();
    }
  }
  async release(): Promise<void> {
    if (!this.token) return;
    const lock=JSON.parse(await readFile(join(this.directory,'.worker.lock'),'utf8')) as {token?:string};
    if (lock.token !== this.token) throw new Error('Job lock ownership changed');
    await rm(join(this.directory,'.worker.lock'));
    this.token=undefined; this.index=undefined;
  }
  async recoverStoppedWorker(): Promise<void> {
    if (this.token || this.locking) throw new Error('Store is active');
    const recoveryPath=join(this.directory,'.worker.recovery.lock');
    let recovery;
    try { recovery=await open(recoveryPath,'wx',0o600); }
    catch(error) {
      if((error as NodeJS.ErrnoException).code==='EEXIST') throw new Error('Another worker is recovering the job lock');
      throw error;
    }
    try {
      const path=join(this.directory,'.worker.lock');
      const owner=JSON.parse(await readFile(path,'utf8')) as {host?:string;pid?:number;token?:string};
      if (owner.host!==hostname() || !Number.isInteger(owner.pid) || owner.pid! <= 0 || typeof owner.token!=='string') throw new Error('Cannot establish local lock owner');
      try { process.kill(owner.pid!,0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('Cannot prove worker stopped');
        const current=JSON.parse(await readFile(path,'utf8')) as {token?:string};
        if(current.token!==owner.token) throw new Error('Lock owner changed');
        await rm(path); return;
      }
      throw new Error('Worker process is still alive');
    } finally { await recovery.close(); await rm(recoveryPath); }
  }
  private requireLock(): void { if(!this.token) throw new Error('Acquire job store before use'); }
  private path(id: string): string {
    if(!/^[0-9a-f]{64}$/.test(id)) throw new Error('Invalid job id');
    return join(this.directory,id+'.json');
  }
  async get(id: string): Promise<JobRecord | undefined> {
    this.requireLock();
    const path=this.path(id);
    try {
      if((await stat(path)).size>1_500_000) throw new Error('Job record too large');
      return parseRecord(JSON.parse(await readFile(path,'utf8')),id);
    } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return undefined; throw error; }
  }
  async list(): Promise<JobSummary[]> {
    this.requireLock();
    if(!this.index) {
      const index=new Map<string, JobSummary>();
      for(const name of (await readdir(this.directory)).filter(n=>/^[0-9a-f]{64}\.json$/.test(n))) { const record=await this.get(name.slice(0,-5)); if(record) index.set(record.id,summary(record)); }
      this.index=index;
    }
    return [...this.index.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>({...s}));
  }
  async delete(id: string): Promise<void> {
    this.requireLock();
    await rm(this.path(id),{force:true}); this.index?.delete(id);
    const directory=await open(this.directory,'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async put(record: JobRecord): Promise<void> {
    this.requireLock(); parseRecord(record,record.id);
    const destination=this.path(record.id), temporary=destination+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,'wx',0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); }
    finally { await file.close(); }
    try {
      await rename(temporary,destination); this.index?.set(record.id,summary(record));
      const directory=await open(this.directory,'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(temporary,{force:true}); }
  }
}
