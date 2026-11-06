import { hash, canonical, identifier, timestamp, canonicalLP } from "../learning-engine/model.js";
export { hash, canonical, timestamp };
export const AUTO_PUBLISH = false;
export const STATES = Object.freeze(["PENDING", "RUNNING", "COMPLETED", "BLOCKED", "FAILED"]);
export const ACTIONS = Object.freeze({ canPublish:false, canPost:false, canStartExperiment:false, canModifyLP:false, canModifyCTA:false, canModifyAffiliateUrl:false, canModifyTracking:false });
export const POLICY = Object.freeze({ version:"publishing-safety-v1", AUTO_PUBLISH, executionMode:"DRY_RUN_ONLY", maxRetries:3, automaticRetry:false, browserExecutorConnected:false });
export function assert(ok, code="SAFETY_CONTRACT_INVALID") { if(!ok) throw new Error(code); }
export const identityOf = r => Object.fromEntries(['experimentId','candidateId','channel','contentUnit','variant'].map(k=>[k,r[k]??null]));
export const payloadOf = r => ({...identityOf(r),targetLP:r.targetLP??null,planId:r.planId??null,contentHash:r.contentHash??null,utmCampaign:r.utmCampaign??null,utmContent:r.utmContent??null,affiliateMeasurementId:r.affiliateMeasurementId??null});
export function validateRequest(r) {
  const allowed=["schemaVersion","purpose","isSynthetic","experimentId","candidateId","channel","targetLP","contentUnit","variant","content","contentHash","planId","plannerManifest","plannerReport","browserProfile","dryRun","retryOfRunId"];
  assert(r && typeof r==='object' && !Array.isArray(r) && Object.keys(r).every(k=>allowed.includes(k)));
  assert(r.schemaVersion===1 && ['AFFILIATE_MONETIZATION','AFFILIATE_NOTE_ACQUISITION'].includes(r.purpose),'PURPOSE_EXCLUDED');
  assert(typeof r.isSynthetic==='boolean');
  for(const k of ['experimentId','candidateId','channel','contentUnit','variant','planId','retryOfRunId']) assert(r[k]==null || identifier(r[k]));
  if(r.targetLP!=null) canonicalLP(r.targetLP);
  assert(r.content==null || typeof r.content==='string' && Buffer.byteLength(r.content)<=1024*1024);
  assert(r.contentHash==null || /^[a-f0-9]{64}$/.test(r.contentHash));
  assert(r.browserProfile==null || /^[A-Za-z0-9_-]{1,64}$/.test(r.browserProfile),'BROWSER_PROFILE_MUST_BE_OPAQUE_LABEL');
  assert(r.dryRun==null || typeof r.dryRun==='boolean');
  return r;
}
export function prepare(r, context={}) {
  validateRequest(r);
  const selector=context.selectorReport, planner=context.plannerReport, current=context.currentReport;
  const plan=current?.plans?.find(p=>p.planId===r.planId), original=planner?.plans?.find(p=>p.planId===r.planId);
  const contentHash=typeof r.content==='string'?hash(r.content):null;
  const identity=Object.fromEntries(['experimentId','candidateId','channel','contentUnit','variant'].map(k=>[k,r[k]??null]));
  const idempotencyKey=hash(identity);
  const payload={...identity,targetLP:r.targetLP??null,planId:r.planId??null,contentHash,
    utmCampaign:original?.utm_campaign??null,utmContent:original?.utm_content??null,affiliateMeasurementId:original?.affiliateMeasurementId??null};
  const reasons=[];
  if(r.dryRun===false) reasons.push('AUTO_PUBLISH_DISABLED');
  if(!r.content?.trim()) reasons.push('CONTENT_NOT_PROVIDED');
  if(r.contentHash!=null && r.contentHash!==contentHash) reasons.push('CONTENT_HASH_MISMATCH');
  if(!context.provenanceVerified) reasons.push('INPUT_PROVENANCE_NOT_VERIFIED');
  if(!selector?.recommendations?.length) reasons.push('NO_SELECTOR_RECOMMENDATION');
  else if(selector.recommendations.length!==1 || !selector.recommendations.some(p=>p.candidateId===r.candidateId && p.proposalId===planner?.selectedProposalId)) reasons.push('SELECTOR_RECOMMENDATION_MISMATCH');
  if(!original || planner?.planStatus!=='READY' || original.planStatus!=='READY') reasons.push('PLANNER_NOT_READY');
  if(!plan || current?.planStatus!=='READY' || plan.planStatus!=='READY') reasons.push('CURRENT_PLAN_NOT_READY');
  if(planner?.selectorRunId!==selector?.runId || current?.selectorRunId!==selector?.runId) reasons.push('SELECTOR_RUN_MISMATCH');
  if(context.provenanceVerified && hash(planner?.inputHashes)!==hash(context.inputHashes)) reasons.push('PLANNER_SOURCE_HASH_MISMATCH');
  if(context.asOf!==current?.asOf) reasons.push('CURRENT_VALIDATION_TIME_MISMATCH');
  for(const k of ['experimentId','candidateId','channel','targetLP','contentUnit','variant','purpose']) {
    if(original?.[k]!==r[k] || plan?.[k]!==r[k]) reasons.push(`PLAN_FIELD_MISMATCH:${k}`);
  }
  for(const k of ['utm_campaign','utm_content','affiliateMeasurementId','affiliateMeasurementIdStatus','fixedVariables']) if(hash(original?.[k]??null)!==hash(plan?.[k]??null)) reasons.push(`PLAN_PREMISE_CHANGED:${k}`);
  if(r.channel==='note' && (r.purpose!=='AFFILIATE_NOTE_ACQUISITION' || plan?.affiliateClickMeasurementStatus!=='VERIFIED')) reasons.push('NOTE_MEASUREMENT_NOT_VERIFIED');
  if(original?.affiliateMeasurementIdStatus!=='VERIFIED_EXISTING') reasons.push('AFFILIATE_LINK_NOT_VERIFIED');
  if(!r.isSynthetic && (selector?.isSynthetic || planner?.isSynthetic || current?.isSynthetic)) reasons.push('SYNTHETIC_INPUT_IN_REAL_RUN');
  const record={...identity,runId:null,planId:r.planId??null,purpose:r.purpose,isSynthetic:r.isSynthetic,targetLP:r.targetLP??null,
    plannedAt:original?planner.asOf:null,startedAt:null,finishedAt:null,contentHash,idempotencyKey,...Object.fromEntries(['utmCampaign','utmContent','affiliateMeasurementId'].map(k=>[k,payload[k]])),
    browserProfile:r.browserProfile??null,humanIntervention:false,retryCount:0,errorReason:null,publishedUrl:null,finalStatus:'PENDING',
    payloadHash:hash(payload),executionMode:'DRY_RUN',AUTO_PUBLISH:false,...ACTIONS,
    sourceHashes:context.sourceHashes??{},validatedAt:context.asOf??null};
  return {record,reasons:[...new Set(reasons)]};
}
