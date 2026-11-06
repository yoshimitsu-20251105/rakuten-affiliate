import { readFile, mkdir, open, rename, rm, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ensurePrivateDirectory } from '../funnel-measurement/store.js';
import { assert, hash, timestamp, STATES, ACTIONS, identityOf, payloadOf } from './model.js';
export const REPO=resolve(fileURLToPath(new URL('../',import.meta.url)));
export const DEFAULT_ROOT=join(REPO,'reports/publishing-safety');
const inside=(parent,path)=>{const rel=relative(parent,path);return rel==='' || !rel.startsWith('..')&&!isAbsolute(rel);};
export async function validateRoot(root) {
  const path=resolve(root);
  if(path===DEFAULT_ROOT) return path;
  assert(!inside(REPO,path),'PROTECTED_REPOSITORY_OUTPUT');
  assert(path!==resolve(tmpdir()) && inside(resolve(tmpdir()),path),'PRIVATE_OUTPUT_REQUIRED');
  // An alternate repository under /tmp is still a repository, not private output.
  for(let parent=path;;parent=dirname(parent)) {
    // Managed environments may place infrastructure metadata at the OS temp
    // root itself. Only dedicated children are allowed, and nested repos are denied.
    if(parent===resolve(tmpdir()))break;
    try { await lstat(join(parent,'.git')); assert(false,'REPOSITORY_OUTPUT_FORBIDDEN'); } catch(e) { if(e.code!=='ENOENT') throw e; }
    if(parent===dirname(parent)) break;
  }
  return path;
}
async function noSymlink(path) {try {assert(!(await lstat(path)).isSymbolicLink(),'SYMLINK_FORBIDDEN');}catch(e){if(e.code!=='ENOENT')throw e;}}
export function latestRuns(ledger) {const rows=new Map();for(const e of ledger.events)rows.set(e.run.runId,e.run);return [...rows.values()];}
export function validateLedger(ledger) {
  assert(ledger?.schemaVersion===1 && ledger.AUTO_PUBLISH===false && Array.isArray(ledger.events),'LEDGER_CORRUPT');
  let previousHash=null;const states=new Map(),logical=new Map();
  for(const [i,e] of ledger.events.entries()) {
    const {eventHash,...payload}=e;
    assert(e.seq===i+1 && e.previousHash===previousHash && hash(payload)===eventHash,'LEDGER_INTEGRITY_FAILURE');
    timestamp(e.at);const r=e.run;assert(r && STATES.includes(r.finalStatus) && r.AUTO_PUBLISH===false && r.publishedUrl===null && r.executionMode==='DRY_RUN','LEDGER_RUN_INVALID');
    for(const k of Object.keys(ACTIONS))assert(r[k]===false,'LEDGER_ACTION_FORBIDDEN');
    for(const k of ['runId','experimentId','candidateId','channel','targetLP','plannedAt','startedAt','finishedAt','contentHash','idempotencyKey','utmCampaign','utmContent','affiliateMeasurementId','browserProfile','humanIntervention','retryCount','errorReason','publishedUrl','finalStatus'])assert(Object.hasOwn(r,k),'LEDGER_FIELD_MISSING');
    assert(hash(identityOf(r))===r.idempotencyKey && hash(payloadOf(r))===r.payloadHash,'RUN_PAYLOAD_INTEGRITY_FAILURE');
    for(const k of ['plannedAt','startedAt','finishedAt','validatedAt'])if(r[k]!==null)timestamp(r[k]);
    assert(typeof r.isSynthetic==='boolean' && ['AFFILIATE_MONETIZATION','AFFILIATE_NOTE_ACQUISITION'].includes(r.purpose),'INVALID_RUN_PURPOSE');
    const prior=states.get(r.runId);assert(!prior?r.finalStatus==='PENDING':prior.finalStatus==='PENDING'?['RUNNING','BLOCKED','FAILED'].includes(r.finalStatus):prior.finalStatus==='RUNNING'?['COMPLETED','FAILED'].includes(r.finalStatus):false,'INVALID_STATE_TRANSITION');
    if(prior) {
      const stable=({finalStatus,startedAt,finishedAt,updatedAt,errorReason,...rest})=>rest;
      assert(hash(stable(r))===hash(stable(prior)),'RUN_IDENTITY_CHANGED');
      if(prior.startedAt!==null)assert(r.startedAt===prior.startedAt,'RUN_START_TIME_CHANGED');
      assert(Date.parse(e.at)>=Date.parse(prior.updatedAt),'NON_MONOTONIC_EVENT');
    } else {
      const old=logical.get(r.idempotencyKey);
      if(r.collision)assert(old && old.payloadHash!==r.payloadHash,'INVALID_COLLISION');
      else if(old)assert(r.previousRunId===old.runId && ['BLOCKED','FAILED'].includes(old.finalStatus) && r.retryCount===old.retryCount+1 && r.payloadHash===old.payloadHash,'DUPLICATE_OR_INVALID_RETRY');
      else assert(r.retryCount===0 && r.previousRunId===null,'INVALID_INITIAL_ATTEMPT');
    }
    assert(r.updatedAt===e.at && typeof r.humanIntervention==='boolean' && Number.isInteger(r.retryCount) && r.retryCount>=0 && r.retryCount<=3,'INVALID_RUN_METADATA');
    assert(r.finalStatus!=='PENDING' || r.startedAt===null && r.finishedAt===null,'INVALID_PENDING_TIMES');
    assert(r.finalStatus!=='RUNNING' || r.startedAt!==null && r.finishedAt===null,'INVALID_RUNNING_TIMES');
    if(r.finalStatus==='RUNNING')assert(r.startedAt===e.at,'INVALID_START_TIME');
    if(r.finalStatus==='COMPLETED')assert(r.startedAt!==null && r.errorReason===null,'INVALID_COMPLETION');
    if(['BLOCKED','FAILED'].includes(r.finalStatus))assert(typeof r.errorReason==='string' && r.errorReason.length>0,'MISSING_FAILURE_REASON');
    if(['COMPLETED','BLOCKED','FAILED'].includes(r.finalStatus))assert(r.finishedAt===e.at,'INVALID_TERMINAL_TIME');
    states.set(r.runId,r);if(!r.collision)logical.set(r.idempotencyKey,r);previousHash=eventHash;
  }
  return ledger;
}
export async function readLedger(root) {
  root=await validateRoot(root);await ensurePrivateDirectory(root);const path=join(root,'ledger.json');await noSymlink(path);
  try { return validateLedger(JSON.parse(await readFile(path,'utf8'))); }
  catch(e) {if(e.code==='ENOENT')return {schemaVersion:1,AUTO_PUBLISH:false,events:[]};throw new Error('LEDGER_UNREADABLE_OR_CORRUPT');}
}
async function persist(root,ledger) {
  validateLedger(ledger);const path=join(root,'ledger.json'),temp=join(root,`.pending-${randomUUID()}`);let file;
  try {
    file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(ledger,null,2)+'\n');await file.sync();await file.close();file=null;
    await noSymlink(path);await rename(temp,path);
    const dir=await open(root,'r');try{await dir.sync();}finally{await dir.close();}
  } finally {if(file)await file.close();await rm(temp,{force:true});}
}
export async function withLedgerLock(root,callback) {
  root=await validateRoot(root);await ensurePrivateDirectory(root);const lock=join(root,'.run-lock');
  try{await mkdir(lock,{mode:0o700});}catch{throw new Error('RUN_LOCK_UNAVAILABLE_MANUAL_RECOVERY_REQUIRED');}
  try {
    const ledger=await readLedger(root);
    const append=async(run,at)=>{
      const normalized=structuredClone({...run,updatedAt:timestamp(at)});
      for(const k of ['plannedAt','startedAt','finishedAt','validatedAt'])if(normalized[k]!==null)normalized[k]=timestamp(normalized[k]);
      const payload={seq:ledger.events.length+1,previousHash:ledger.events.at(-1)?.eventHash??null,at:timestamp(at),run:normalized};
      const next={...ledger,events:[...ledger.events,{...payload,eventHash:hash(payload)}]};await persist(root,next);ledger.events=next.events;return structuredClone(payload.run);
    };
    return await callback(ledger,append);
  } finally {await rm(lock,{recursive:true,force:true});}
}
