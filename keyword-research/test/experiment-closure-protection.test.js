import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../../learning-engine/model.js';
import {permittedExperimentClosure} from './protected-assets-helpers.js';
function fixture(){
  const old={items:[{experimentId:'test',status:'RUNNING',result:null,decision:null,startDate:'2026-10-13',reviewDate:'2026-10-27',hypothesis:'Fixed hypothesis',successThreshold:{channelSessionsMin:20},metrics:[{old:'retained'}],learnings:['old retained']},{experimentId:'other',status:'RUNNING'}]},current=structuredClone(old),record=current.items[0];
  Object.assign(record,{status:'INCONCLUSIVE',result:'INCONCLUSIVE',decision:'HOLD',metrics:[...record.metrics,{new:'confirmed'}],learnings:[...record.learnings,'new final learning']});
  const period={start:'2026-10-13',end:'2026-10-27'},closure={schemaVersion:1,kind:'EXPERIMENT_CLOSURE',experimentId:'test',authorizedBy:'user',authorizationReference:'Synthetic explicit authorization',priorRecordHash:hash(old.items[0]),finalRecordHash:hash(record),period,appendedMetrics:[{new:'confirmed'}],appendedLearnings:['new final learning'],evidence:{period,ga4:{note:{sessions:1},x:{sessions:1},affiliateClick:{status:'NO_ROWS_RETURNED',value:null},postPeriodIncluded:false},trafficSufficiency:{value:'FAILED',thresholdPerChannel:20}},actions:{closeExistingExperiment:true,startNewExperiment:false,publish:false,post:false,AUTO_PUBLISH:false}};
  return {old,current,closure};
}
test('An explicitly evidenced INCONCLUSIVE/HOLD closure preserves other records, thresholds and all history',()=>{
  const f=fixture();assert(permittedExperimentClosure(JSON.stringify(f.old),JSON.stringify(f.current),f.closure));
});
test('Explicit measurement-blocked operational HOLD may pause SEO, while elapsed-date-only closure is rejected',()=>{
  const f=fixture();f.current.items[0].status='STOPPED';f.closure.finalRecordHash=hash(f.current.items[0]);f.closure.reasonType='MEASUREMENT_UNAVAILABLE_OPERATIONAL_HOLD';f.closure.evidence={currentObservation:{status:'MISSING',apiCalls:0,reason:'AUTH_CONFIGURATION_UNAVAILABLE'},reviewDate:f.old.items[0].reviewDate};
  assert(permittedExperimentClosure(JSON.stringify(f.old),JSON.stringify(f.current),f.closure));delete f.closure.evidence.currentObservation.reason;
  assert(!permittedExperimentClosure(JSON.stringify(f.old),JSON.stringify(f.current),f.closure));
});
for(const [name,mutate] of [
  ['changed hypothesis',f=>f.current.items[0].hypothesis='changed'],
  ['changed threshold',f=>f.current.items[0].successThreshold.channelSessionsMin=1],
  ['changed unrelated experiment',f=>f.current.items[1].status='STOPPED'],
  ['deleted observations',f=>f.current.items[0].metrics.shift()],
  ['KILL',f=>f.current.items[0].decision='KILL'],
  ['FAILED overall result',f=>f.current.items[0].result='FAILED'],
  ['still RUNNING',f=>f.current.items[0].status='RUNNING'],
  ['unproven low traffic',f=>f.closure.evidence.ga4.note.sessions=21],
  ['post-period mixing',f=>f.closure.evidence.ga4.postPeriodIncluded=true],
  ['missing event coerced to zero',f=>f.closure.evidence.ga4.affiliateClick.value=0],
  ['automatic start',f=>f.closure.actions.startNewExperiment=true],
  ['missing authorization',f=>f.closure.authorizedBy='unknown']
])test(`Closure protection rejects ${name} even if a final record hash is recomputed`,()=>{
  const f=fixture();mutate(f);f.closure.finalRecordHash=hash(f.current.items[0]);assert(!permittedExperimentClosure(JSON.stringify(f.old),JSON.stringify(f.current),f.closure));
});
