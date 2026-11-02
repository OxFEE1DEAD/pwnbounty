import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { FileJobStore } from '../src/job-store.ts';
import { JobQueue, NonRetryablePrepareError, type JobProcessor } from '../src/jobs.ts';
import type { SealedReport } from '../src/interfaces.ts';

const report:SealedReport={network:'testnet',contract:'bounty.testnet',bounty:'0',hunter:'hunter.testnet',submission:'0'.repeat(64),report_hash:'1'.repeat(64),ciphertext:Buffer.alloc(93)};

async function withStore(run:(store:FileJobStore)=>Promise<void>):Promise<void> {
  const directory=await mkdtemp(join(tmpdir(),'sealed-bounty-jobs-test-'));
  const store=new FileJobStore(directory);
  try { await store.acquire(); await run(store); }
  finally { await store.release(); await rm(directory,{recursive:true,force:true}); }
}

test('an uncertain paid preparation is not submitted again',async()=>withStore(async store=>{
  let calls=0;
  const processor:JobProcessor={nonRepeatablePrepare:true,
    async prepare(){calls++;throw new NonRetryablePrepareError('unknown call outcome');},
    async deliver(){throw new Error('unreachable');}};
  const queue=new JobQueue(store,processor);
  await queue.enqueue(report);
  const first=await queue.runNext();
  assert.equal(first?.state,'failed');
  assert.equal(first?.prepareAttempts,1);
  assert.equal(await queue.runNext(),undefined);
  assert.equal(calls,1);
}));

test('restart does not repeat a paid preparation left in progress',async()=>withStore(async store=>{
  let calls=0;
  const processor:JobProcessor={nonRepeatablePrepare:true,
    async prepare(){calls++;throw new Error('unreachable');},
    async deliver(){throw new Error('unreachable');}};
  const queue=new JobQueue(store,processor);
  const record=await queue.enqueue(report);
  record.state='preparing';record.prepareAttempts=1;
  await store.put(record);
  const recovered=await new JobQueue(store,processor).runNext();
  assert.equal(recovered?.state,'failed');
  assert.equal(calls,0);
}));

test('restart resumes the recorded call rather than creating another',async()=>withStore(async store=>{
  const callId='550e8400-e29b-41d4-a716-446655440000';
  let resumed:string|undefined;
  const processor:JobProcessor={nonRepeatablePrepare:true,
    async prepare(_report,checkpoint){resumed=checkpoint?.callId;throw new NonRetryablePrepareError('call failed');},
    async deliver(){throw new Error('unreachable');}};
  const queue=new JobQueue(store,processor);
  const record=await queue.enqueue(report);
  record.state='preparing';record.prepareAttempts=1;record.externalCallId=callId;
  await store.put(record);
  const recovered=await new JobQueue(store,processor).runNext();
  assert.equal(resumed,callId);
  assert.equal(recovered?.state,'failed');
}));

test('runner cannot take a lock held by a live worker',async()=>withStore(async store=>{
  await assert.rejects(new FileJobStore(store.directory).acquireRecoveringStoppedWorker(),/Worker process is still alive/);
}));

test('runner recovers the lock of a verified stopped worker',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sealed-bounty-recovery-test-'));
  const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});
  const pid=child.pid;
  await once(child,'exit');
  assert.ok(pid);
  await writeFile(join(directory,'.worker.lock'),JSON.stringify({version:1,token:'stopped-worker',pid,host:hostname()}));
  const store=new FileJobStore(directory);
  try { await store.acquireRecoveringStoppedWorker(); await store.release(); }
  finally { await rm(directory,{recursive:true,force:true}); }
});

test('parallel recovery leaves exactly one worker holding the job store',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'sealed-bounty-parallel-recovery-test-'));
  const child=spawn(process.execPath,['-e',''],{stdio:'ignore'});
  const pid=child.pid;
  await once(child,'exit');
  assert.ok(pid);
  await writeFile(join(directory,'.worker.lock'),JSON.stringify({version:1,token:'stopped-worker',pid,host:hostname()}));
  const stores=[new FileJobStore(directory),new FileJobStore(directory)];
  try {
    const outcomes=await Promise.allSettled(stores.map(store=>store.acquireRecoveringStoppedWorker()));
    assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
    await assert.rejects(new FileJobStore(directory).acquire(),{code:'EEXIST'});
    await stores[outcomes.findIndex(outcome=>outcome.status==='fulfilled')]!.release();
  } finally { await rm(directory,{recursive:true,force:true}); }
});
