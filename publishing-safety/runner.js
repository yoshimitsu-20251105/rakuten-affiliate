import { assert, prepare, hash, timestamp, POLICY } from './model.js';
import { withLedgerLock, latestRuns } from './store.js';

// There is deliberately no browser/post/publish adapter. COMPLETED means a
// dry-run passed checks; it never means a post was published or an experiment started.
export async function runSafety(root,request,context={}, {clock=()=>new Date().toISOString(),autoPublishEnvironment=process.env.AUTO_PUBLISH,check=()=>{}}={}) {
  const prepared=prepare(request,context);
  return withLedgerLock(root,async(ledger,append)=>{
    const runs=latestRuns(ledger),same=runs.filter(r=>r.idempotencyKey===prepared.record.idempotencyKey && !r.collision),previous=same.at(-1);
    let count=0,collision=false;const reasons=[...prepared.reasons];
    if(autoPublishEnvironment!=null && autoPublishEnvironment!=='false')reasons.push('AUTO_PUBLISH_OVERRIDE_REJECTED');
    if(previous) {
      collision=previous.payloadHash!==prepared.record.payloadHash;
      if(collision)reasons.push('IDEMPOTENCY_PAYLOAD_CONFLICT');
      else if(!request.retryOfRunId)return {status:'DUPLICATE',run:previous,AUTO_PUBLISH:false,currentCheckStatus:reasons.length?'BLOCKED':'VALIDATED',currentBlockingReasons:reasons};
      else {
        assert(request.retryOfRunId===previous.runId && ['BLOCKED','FAILED'].includes(previous.finalStatus),'RETRY_NOT_ALLOWED');
        count=previous.retryCount+1;assert(count<=POLICY.maxRetries,'RETRY_LIMIT_REACHED');
      }
    } else assert(!request.retryOfRunId,'RETRY_PARENT_NOT_FOUND');
    const runId=`run-${hash([prepared.record.idempotencyKey,prepared.record.payloadHash,collision?'collision':count])}`;
    const prior=runs.find(r=>r.runId===runId);if(prior)return {status:'DUPLICATE',run:prior,AUTO_PUBLISH:false};
    let run={...prepared.record,runId,retryCount:count,collision,previousRunId:request.retryOfRunId??null};
    run=await append(run,clock());
    if(reasons.length) {
      const at=timestamp(clock());run=await append({...run,finalStatus:'BLOCKED',finishedAt:at,errorReason:[...new Set(reasons)].join(';')},at);
      return {status:'RECORDED',run,AUTO_PUBLISH:false};
    }
    const at=timestamp(clock());run=await append({...run,finalStatus:'RUNNING',startedAt:at},at);
    try {
      await check(); // Injected dry-run check for deterministic failure tests only.
      const end=timestamp(clock());run=await append({...run,finalStatus:'COMPLETED',finishedAt:end},end);
    } catch {
      const end=timestamp(clock());run=await append({...run,finalStatus:'FAILED',finishedAt:end,errorReason:'DRY_RUN_CHECK_FAILED'},end);
    }
    return {status:'RECORDED',run,AUTO_PUBLISH:false};
  });
}
