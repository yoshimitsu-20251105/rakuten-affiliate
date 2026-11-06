import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,lstat,symlink,access } from 'node:fs/promises';
import { join } from 'node:path';
import { runSafety } from '../../publishing-safety/runner.js';
import { readLedger,latestRuns,withLedgerLock,validateRoot,REPO } from '../../publishing-safety/store.js';
import { prepare,hash,ACTIONS } from '../../publishing-safety/model.js';
import { fixture,temporary,AS_OF } from './publishing-safety-helpers.js';
const options={clock:()=>AS_OF,autoPublishEnvironment:'false'};
test('Durable PENDING/RUNNING/COMPLETED history stores required fields, not draft text or a claimed publication',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture(),out=await runSafety(temp.root,request,context,options),ledger=await readLedger(temp.root);
  assert.equal(out.run.finalStatus,'COMPLETED');assert.deepEqual(ledger.events.map(e=>e.run.finalStatus),['PENDING','RUNNING','COMPLETED']);
  for(const k of ['runId','experimentId','candidateId','channel','targetLP','plannedAt','startedAt','finishedAt','contentHash','idempotencyKey','utmCampaign','utmContent','affiliateMeasurementId','browserProfile','humanIntervention','retryCount','errorReason','publishedUrl','finalStatus'])assert(Object.hasOwn(out.run,k),k);
  for(const k of Object.keys(ACTIONS))assert.equal(out.run[k],false);
  const bytes=await readFile(join(temp.root,'ledger.json'),'utf8');assert(!bytes.includes(request.content));assert.equal(out.run.publishedUrl,null);
  assert.equal((await lstat(temp.root)).mode&0o777,0o700);assert.equal((await lstat(join(temp.root,'ledger.json'))).mode&0o777,0o600);
});
test('Persisted duplicate is a no-op; changed content with same key is durably BLOCKED',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();await runSafety(temp.root,request,context,options);
  const before=await readFile(join(temp.root,'ledger.json'),'utf8');assert.equal((await runSafety(temp.root,request,context,options)).status,'DUPLICATE');assert.equal(await readFile(join(temp.root,'ledger.json'),'utf8'),before);
  const other={...request,content:'CHANGED SYNTHETIC CONTENT'},blocked=await runSafety(temp.root,other,context,options);assert.equal(blocked.run.finalStatus,'BLOCKED');assert.match(blocked.run.errorReason,/IDEMPOTENCY_PAYLOAD_CONFLICT/);
  const ledger=await readLedger(temp.root);assert.equal(latestRuns(ledger).length,2);assert.equal(ledger.events.length,5);
  assert.equal((await runSafety(temp.root,other,context,options)).status,'DUPLICATE');assert.equal((await readLedger(temp.root)).events.length,5);
});
test('No browser executor is required; publication override cannot call dry-run check',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();let calls=0;
  const out=await runSafety(temp.root,request,context,{...options,autoPublishEnvironment:'true',check:()=>calls++});
  assert.equal(out.run.finalStatus,'BLOCKED');assert.match(out.run.errorReason,/AUTO_PUBLISH_OVERRIDE_REJECTED/);assert.equal(calls,0);assert.equal(out.AUTO_PUBLISH,false);
});
test('A duplicate completed dry-run is historical; stale current checks are reported as BLOCKED',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();await runSafety(temp.root,request,context,options);
  context.currentReport.planStatus='BLOCKED';const out=await runSafety(temp.root,request,context,options);
  assert.equal(out.status,'DUPLICATE');assert.equal(out.currentCheckStatus,'BLOCKED');assert(out.currentBlockingReasons.includes('CURRENT_PLAN_NOT_READY'));
  assert.equal((await readLedger(temp.root)).events.length,3);
});
test('Failure is persistent and redacted; retry is explicit, bounded, and preserves every earlier event',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture(),fail={...options,check:()=>{throw new Error('PRIVATE_SECRET_MUST_NOT_LEAK');}};
  let out=await runSafety(temp.root,request,context,fail);assert.equal(out.run.finalStatus,'FAILED');assert.equal(out.run.errorReason,'DRY_RUN_CHECK_FAILED');
  assert.equal((await runSafety(temp.root,request,context,options)).status,'DUPLICATE');
  for(let i=1;i<=3;i++){out=await runSafety(temp.root,{...request,retryOfRunId:out.run.runId},context,fail);assert.equal(out.run.retryCount,i);}
  const before=await readFile(join(temp.root,'ledger.json'),'utf8');assert(!before.includes('PRIVATE_SECRET'));
  await assert.rejects(runSafety(temp.root,{...request,retryOfRunId:out.run.runId},context,options),/RETRY_LIMIT/);
  assert.equal(await readFile(join(temp.root,'ledger.json'),'utf8'),before);assert.equal((await readLedger(temp.root)).events.length,12);
});
test('Exclusive lock rejects competing writers and is never stolen as stale',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();await mkdir(join(temp.root,'.run-lock'));
  await assert.rejects(runSafety(temp.root,request,context,options),/LOCK_UNAVAILABLE/);await access(join(temp.root,'.run-lock'));
  await assert.rejects(access(join(temp.root,'ledger.json')));
});
test('Concurrent identical requests cannot create multiple runs',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();const results=await Promise.allSettled(Array.from({length:8},()=>runSafety(temp.root,request,context,options)));
  assert(results.some(r=>r.status==='fulfilled'));const ledger=await readLedger(temp.root);assert.equal(latestRuns(ledger).length,1);assert.equal(ledger.events.length,3);
});
test('Interrupted RUNNING remains RUNNING; no automatic retry or completion after restart',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture(),r=prepare(request,context).record;
  const run={...r,runId:`run-${hash([r.idempotencyKey,r.payloadHash,0])}`,collision:false,previousRunId:null};
  await withLedgerLock(temp.root,async(l,append)=>{await append(run,AS_OF);await append({...run,finalStatus:'RUNNING',startedAt:AS_OF},AS_OF);});
  const out=await runSafety(temp.root,request,context,options);assert.equal(out.status,'DUPLICATE');assert.equal(out.run.finalStatus,'RUNNING');assert.equal((await readLedger(temp.root)).events.length,2);
  await assert.rejects(runSafety(temp.root,{...request,retryOfRunId:run.runId},context,options),/RETRY_NOT_ALLOWED/);
});
test('Corrupt and tampered history cannot be silently replaced',async(t)=>{
  const temp=await temporary(t),{request,context}=await fixture();await runSafety(temp.root,request,context,options);
  const path=join(temp.root,'ledger.json'),raw=await readFile(path,'utf8'),changed=raw.replace('COMPLETED','FAILED');await writeFile(path,changed);
  await assert.rejects(runSafety(temp.root,request,context,options),/CORRUPT/);assert.equal(await readFile(path,'utf8'),changed);
  await writeFile(path,'{invalid');await assert.rejects(readLedger(temp.root),/CORRUPT/);assert.equal(await readFile(path,'utf8'),'{invalid');
});
test('Output protection includes repositories under OS temp and symlinked storage',async(t)=>{
  const temp=await temporary(t),other=await temporary(t);await assert.rejects(validateRoot(join(REPO,'docs')));await assert.rejects(validateRoot(REPO));
  const repo=join(temp.root,'repo');await mkdir(repo);await writeFile(join(repo,'.git'),'synthetic worktree marker');await assert.rejects(validateRoot(join(repo,'docs')),/REPOSITORY_OUTPUT/);
  await symlink(other.root,join(temp.root,'alias'));await assert.rejects(readLedger(join(temp.root,'alias')));
  await symlink(join(other.root,'ledger.json'),join(temp.root,'ledger.json'));await assert.rejects(readLedger(temp.root));
});
