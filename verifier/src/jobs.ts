import { canonical } from '../../protocol/index.ts';
import type { SealedReport } from './interfaces.ts';
import { FileJobStore, programKey, reportId, restorePrepared, restoreReport, storePrepared, storeReport, type JobRecord, type PreparedJob } from './job-store.ts';

export interface JobProcessor {
  nonRepeatablePrepare?: boolean;
  prepare(report: SealedReport, checkpoint?: {callId?:string; accepted(callId:string):Promise<void>}): Promise<PreparedJob>;
  deliver(prepared: PreparedJob): Promise<{transaction: string}>;
}
export class NonRetryablePrepareError extends Error {}
export interface JobLimits {
  maxJobs: number;
  maxJobsPerProgram: number;
  maxPrepareAttempts: number;
  maxDeliveryAttempts: number;
  retryDelayMs: number;
  terminalRetentionMs: number;
}
export const DEFAULT_JOB_LIMITS: JobLimits = {
  maxJobs: 1024, maxJobsPerProgram: 64, maxPrepareAttempts: 2, maxDeliveryAttempts: 5, retryDelayMs: 5000, terminalRetentionMs: 7*24*60*60*1000,
};
export class JobQueue {
  private admission: Promise<unknown>=Promise.resolve();
  private processing=false;
  readonly limits: JobLimits;
  constructor(private store: FileJobStore, private processor: JobProcessor, limits: Partial<JobLimits>={}) {
    this.limits={...DEFAULT_JOB_LIMITS,...limits};
    if(!Object.values(this.limits).every(v=>Number.isSafeInteger(v)&&v>0)) throw new Error('Invalid job limits');
    if(this.limits.maxJobs>100_000 || this.limits.maxJobsPerProgram>this.limits.maxJobs || this.limits.maxPrepareAttempts>10 || this.limits.maxDeliveryAttempts>100) throw new Error('Unsafe job limits');
  }
  private exclusive<T>(action:()=>Promise<T>): Promise<T> {
    const next=this.admission.then(action,action);
    this.admission=next.catch(()=>{});
    return next;
  }
  async enqueue(report: SealedReport): Promise<JobRecord> {
    return this.exclusive(async()=>{
      const stored=storeReport(report), id=reportId(stored), existing=await this.store.get(id);
      if(existing) {
        if(canonical(existing.report)!==canonical(stored)) throw new Error('Submission already exists with different payload');
        return existing;
      }
      const jobs=await this.store.list();
      const now=Date.now();
      for(const old of jobs) if(['complete','failed'].includes(old.state)&&now-old.updatedAt>=this.limits.terminalRetentionMs) await this.store.delete(old.id);
      const active=jobs.filter(j=>!['complete','failed'].includes(j.state));
      const sameProgram=active.filter(j=>j.program===programKey(stored));
      if(active.length>=this.limits.maxJobs || sameProgram.length>=this.limits.maxJobsPerProgram) throw new Error('Submission quota exhausted');
      const job: JobRecord={version:1,id,report:stored,state:'queued',createdAt:now,updatedAt:now,nextAttemptAt:now,prepareAttempts:0,deliveryAttempts:0};
      await this.store.put(job); return job;
    });
  }
  async runNext(): Promise<JobRecord | undefined> {
    if(this.processing) return undefined;
    this.processing=true;
    try {
      const jobs=(await this.store.list()).sort((a,b)=>a.createdAt-b.createdAt || a.id.localeCompare(b.id));
      const next=jobs.find(j=>!['complete','failed'].includes(j.state)&&j.nextAttemptAt<=Date.now());
      const job=next&&await this.store.get(next.id);
      if(!job) return undefined;
      if(!job.prepared) {
        if(job.state==='preparing'&&this.processor.nonRepeatablePrepare&&!job.externalCallId) return await this.failure(job,'PREPARE_FAILED',true,'queued',new Error('Previous paid preparation outcome is unknown; reconcile manually'));
        if(job.prepareAttempts>=this.limits.maxPrepareAttempts) return await this.exhaust(job);
        job.state='preparing'; job.prepareAttempts++; await this.save(job);
        let prepared: PreparedJob;
        try { prepared=await this.processor.prepare(restoreReport(job.report),{callId:job.externalCallId,accepted:async callId=>{job.externalCallId=callId;await this.save(job);}}); }
        catch(error) { return await this.failure(job,'PREPARE_FAILED',error instanceof NonRetryablePrepareError||job.prepareAttempts>=this.limits.maxPrepareAttempts,'queued',error); }
        job.prepared=storePrepared(prepared); job.state='prepared'; delete job.errorCode; await this.save(job);
      }
      if(job.deliveryAttempts>=this.limits.maxDeliveryAttempts) return await this.exhaust(job);
      job.state='delivering'; job.deliveryAttempts++; await this.save(job);
      let transaction: string;
      try { ({transaction}=await this.processor.deliver(restorePrepared(job.prepared))); }
      catch(error) { return await this.failure(job,'DELIVERY_FAILED',job.deliveryAttempts>=this.limits.maxDeliveryAttempts,'prepared',error); }
      if(!transaction || transaction.length>4096) return await this.failure(job,'DELIVERY_FAILED',job.deliveryAttempts>=this.limits.maxDeliveryAttempts,'prepared');
      job.transaction=transaction; job.state='complete'; delete job.errorCode;
      await this.save(job); return job;
    } finally { this.processing=false; }
  }
  private async failure(job: JobRecord, code: 'PREPARE_FAILED'|'DELIVERY_FAILED', exhausted: boolean, retryState: 'queued'|'prepared', error?: unknown): Promise<JobRecord> {
    console.error(JSON.stringify({id:job.id,code,error:(error instanceof Error?error.message:'invalid result').slice(0,200)}));
    job.state=exhausted?'failed':retryState; job.errorCode=code;
    const attempts=code==='PREPARE_FAILED'?job.prepareAttempts:job.deliveryAttempts;
    job.nextAttemptAt=Date.now()+Math.min(this.limits.retryDelayMs*2**Math.min(attempts-1,10),300_000);
    await this.save(job); return job;
  }
  private async exhaust(job: JobRecord): Promise<JobRecord> {
    job.state='failed'; job.errorCode='ATTEMPTS_EXHAUSTED'; await this.save(job); return job;
  }
  private async save(job: JobRecord): Promise<void> { job.updatedAt=Date.now(); await this.store.put(job); }
}
