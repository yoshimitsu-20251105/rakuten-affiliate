import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare,AUTO_PUBLISH,ACTIONS } from '../../publishing-safety/model.js';
import { fixture } from './publishing-safety-helpers.js';

test('A fully validated dry-run is ready for checks without granting any action permission',async()=>{
  const {request,context}=await fixture(),r=prepare(request,context);assert.deepEqual(r.reasons,[]);assert.equal(AUTO_PUBLISH,false);
  for(const k of Object.keys(ACTIONS))assert.equal(r.record[k],false);
  assert.equal(r.record.publishedUrl,null);assert.equal(r.record.humanIntervention,false);
});
for(const [name,mutate,reason] of [
  ['zero recommendations',(r,c)=>c.selectorReport.recommendations=[],'NO_SELECTOR_RECOMMENDATION'],
  ['unverified note LP',(r,c)=>c.currentReport.plans[0].affiliateClickMeasurementStatus='NOT_VERIFIED','NOTE_MEASUREMENT_NOT_VERIFIED'],
  ['unimplemented note measurement',(r,c)=>c.currentReport.plans[0].affiliateClickMeasurementStatus='NOT_IMPLEMENTED','NOTE_MEASUREMENT_NOT_VERIFIED'],
  ['stale LP premise',(r,c)=>c.currentReport.plans[0].fixedVariables.pageHash='changed','PLAN_PREMISE_CHANGED:fixedVariables'],
  ['current concurrency/retry blocked',(r,c)=>c.currentReport.planStatus='BLOCKED','CURRENT_PLAN_NOT_READY'],
  ['wrong candidate',(r)=>r.candidateId='other','PLAN_FIELD_MISMATCH:candidateId'],
  ['wrong LP',(r)=>r.targetLP='https://example.test/other.html','PLAN_FIELD_MISMATCH:targetLP'],
  ['proposed measurement ID',(r,c)=>c.plannerReport.plans[0].affiliateMeasurementIdStatus='PROPOSED','AFFILIATE_LINK_NOT_VERIFIED'],
  ['raw source hash mismatch',(r,c)=>c.inputHashes={modified:'hash'},'PLANNER_SOURCE_HASH_MISMATCH'],
  ['publication request',(r)=>r.dryRun=false,'AUTO_PUBLISH_DISABLED'],
  ['content hash mismatch',(r)=>r.contentHash='a'.repeat(64),'CONTENT_HASH_MISMATCH'],
  ['missing draft',(r)=>r.content=null,'CONTENT_NOT_PROVIDED'],
  ['unverified provenance',(r,c)=>c.provenanceVerified=false,'INPUT_PROVENANCE_NOT_VERIFIED'],
])test(`Safety blocks ${name}`,async()=>{
  const {request,context}=await fixture();mutate(request,context);assert(prepare(request,context).reasons.includes(reason));
});
test('Native note purpose and browser authentication paths are excluded',async()=>{
  const {request,context}=await fixture();assert.throws(()=>prepare({...request,purpose:'NOTE_NATIVE_MONETIZATION'},context));
  assert.throws(()=>prepare({...request,browserProfile:'/Users/private/Chrome/Default'},context));
});
test('Same logical request has stable identifiers; content changes retain key but change material hash',async()=>{
  const {request,context}=await fixture(),a=prepare(request,context),b=prepare({...request},context),c=prepare({...request,content:'DIFFERENT SYNTHETIC DRAFT'},context);
  assert.equal(a.record.idempotencyKey,b.record.idempotencyKey);assert.equal(a.record.payloadHash,b.record.payloadHash);
  assert.equal(a.record.idempotencyKey,c.record.idempotencyKey);assert.notEqual(a.record.payloadHash,c.record.payloadHash);
});
test('Missing input remains null and blocked rather than becoming an observed zero',()=>{
  const r=prepare({schemaVersion:1,purpose:'AFFILIATE_MONETIZATION',isSynthetic:false},{});
  for(const k of ['experimentId','candidateId','targetLP','contentHash','utmCampaign','utmContent','affiliateMeasurementId','plannedAt','publishedUrl'])assert.equal(r.record[k],null);
  assert(r.reasons.length>0);
});
