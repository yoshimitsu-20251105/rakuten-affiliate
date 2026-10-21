import test from "node:test";
import assert from "node:assert/strict";
import { data, run, assessmentFor, metricParts, COMPONENT_KEYS } from "./opportunity-scorer-helpers.js";
import { hash } from "../../opportunity-scorer/model.js";
import { verified } from "./funnel-helpers.js";

test("approved partial example preserves 30/null/20/12 and returns total null", async () => {
  const d = await data(), input = d.context.assessments.find((r) => r.components.offerFit.value === null);
  const a = assessmentFor(run(d), input.candidateId);
  assert.deepEqual(Object.values(a.components).map((c) => c.value), [30, null, 20, 12]);
  assert.equal(a.exploration.totalScore, null); assert.equal(a.explorationRank, null);
  assert.equal(a.components.offerFit.evidenceType, "UNKNOWN");
  for (const key of COMPONENT_KEYS) assert(Object.hasOwn(a.components.offerFit, key));
});

test("complete weighted values sum to 86 without multiplying weights a second time", async () => {
  const d = await data({ complete: true });
  const result = run(d);
  assert(result.assessments.every((a) => a.exploration.totalScore === 86 && a.exploration.evidenceType === "HYPOTHESIS"));
  assert(result.assessments.every((a) => Object.values(a.components).every((c) => c.evidenceType === "HYPOTHESIS")));
});

test("actual zero is retained; null, blank and UNKNOWN never become zero or a partial total", async () => {
  const d = await data({ complete: true });
  for (const row of d.context.assessments) for (const c of Object.values(row.components)) c.value = 0;
  assert(run(d).assessments.every((a) => a.exploration.totalScore === 0));
  for (const value of [null, "", "UNKNOWN"]) {
    const copy = structuredClone(d); copy.context.assessments[0].components.offerFit.value = value;
    const a = assessmentFor(run(copy), copy.context.assessments[0].candidateId);
    assert.equal(a.exploration.totalScore, null); assert.equal(a.components.purchaseIntent.value, 0);
  }
  d.context.assessments[0].components.offerFit.evidenceType = "UNKNOWN";
  assert.equal(assessmentFor(run(d), d.context.assessments[0].candidateId).exploration.totalScore, null);
});

test("missing optional context uses only explicit intent rules, not LP/offer counts or implicit scores", async () => {
  const d = await data(); d.context = null;
  for (const a of run(d).assessments) {
    assert.equal(a.components.purchaseIntent.value, 26.25);
    assert.equal(a.components.offerFit.value, null); assert.equal(a.components.lpReuse.value, null);
    assert.equal(a.components.demand.value, null); assert.equal(a.exploration.totalScore, null);
  }
  for (const intent of [null, "PROBLEM_SOLUTION", "INFORMATIONAL"]) {
    const c = structuredClone(d); c.scanner.candidates[0].intent.value = intent;
    assert.equal(assessmentFor(run(c), c.scanner.candidates[0].candidateId).components.purchaseIntent.value, null);
  }
});

test("stale, missing-date, unconfigured and future demand evidence are not renewed by parsing", async () => {
  for (const change of [
    (d, e) => { e.retrievedAt = null; }, (d, e) => { e.periodEnd = null; },
    (d) => { d.scanner.policy = {}; }, (d, e) => { e.retrievedAt = "2027-01-01T00:00:00Z"; },
    (d, e) => { e.retrievedAt = "2025-01-01T00:00:00Z"; },
  ]) {
    const d = await data({ complete: true });
    const id = d.scanner.candidates[0].demandEvidence[0], e = d.scanner.evidence.find((r) => r.evidenceId === id); change(d, e);
    const a = assessmentFor(run(d), d.scanner.candidates[0].candidateId);
    assert.equal(a.components.demand.value, null); assert.equal(a.exploration.totalScore, null);
  }
});

test("range/null evidence, zero GSC and conflicting reviews do not create a demand score", async () => {
  const d = await data({ complete: true });
  const candidate = d.scanner.candidates[0], e = d.scanner.evidence.find((v) => v.evidenceId === candidate.demandEvidence[0]);
  e.value = null; e.rawValue = "100〜1000";
  assert.equal(assessmentFor(run(d), candidate.candidateId).components.demand.value, null);
  const g = await data({ complete: true });
  g.scanner.inputs.find((s) => s.sourceId === "gkp").sourceType = "gsc_csv";
  const ge = g.scanner.evidence.find((v) => v.evidenceId === g.scanner.candidates[0].demandEvidence[0]); ge.value = 0;
  g.context.assessments[0].components.demand.value = 0;
  assert.equal(assessmentFor(run(g), g.scanner.candidates[0].candidateId).components.demand.missingReason, "ZERO_GSC_NOT_MARKET_DEMAND_PROOF");
  const h = await data({ complete: true }), claim = h.context.assessments[0].components.offerFit;
  h.context.assessments[0].components.offerFit = [claim, { ...claim, value: 30 }];
  assert.equal(assessmentFor(run(h), h.context.assessments[0].candidateId).components.offerFit.missingReason, "CONFLICT");
});

test("identical repeated review is not an extra score and expired/future reviews stay null", async () => {
  const d = await data({ complete: true }), row = d.context.assessments[0];
  row.components.offerFit = [row.components.offerFit, structuredClone(row.components.offerFit)];
  assert.equal(assessmentFor(run(d), row.candidateId).components.offerFit.value, 24);
  row.assessedAt = "2027-01-01T00:00:00Z";
  assert.equal(assessmentFor(run(d), row.candidateId).components.offerFit.value, null);
  row.assessedAt = "2026-10-20T00:00:00Z"; row.applicablePeriod.start = "2026-10-01"; row.applicablePeriod.end = "2026-10-20";
  assert.equal(assessmentFor(run(d), row.candidateId).components.offerFit.value, null);
});

test("synthetic Funnel never becomes observed real performance", async () => {
  assert(run(await data()).observedPerformance.every((r) => Object.values(r.metrics).every((m) => m.value === null)));
});

test("Funnel FACT lineage preserves rewards, progressing-month snapshot and partial verification", async () => {
  const d = await data({ nonSyntheticSchemaBranch: true });
  const result = run(d);
  assert.deepEqual(result.observedPerformance.map((r) => r.metrics.revenue.value).sort((a,b) => a-b), [100, 200]);
  for (const r of result.observedPerformance) {
    assert.equal(r.metrics.revenue.evidenceType, "FACT");
    assert.equal(r.metrics.revenue.context.periodStatus, "IN_PROGRESS"); assert.equal(r.metrics.revenue.final, false);
    assert.equal(r.metrics.conversions.value, null); assert.equal(r.metrics.conversions.validationStatus, "PARTIALLY_VERIFIED");
    assert.equal(r.metrics.epc.value, null);
  }
});

test("non-FACT, partial, absent source and broken mapping stay null without losing source observation", async () => {
  for (const change of [
    ({raw}) => {raw.evidenceType="ESTIMATE";}, ({raw}) => {raw.evidenceType="HYPOTHESIS";},
    ({raw}) => {raw.availability="PARTIAL";}, ({raw}) => {raw.mappingEvidenceReference=null;},
    ({saved}) => {saved.report.sourceBatch.recordCount=0;}, ({saved}) => {saved.report.sourceBatch.coverage="PARTIAL";},
    ({evidence}) => {evidence.metricOrClaim="account_revenue";}, ({raw}) => {raw.scope.measurementId="not-in-records";},
    ({saved}) => {saved.report.sourceBatch.snapshotAsOf="2027-01-01T00:00:00Z";},
  ]) {
    const d=await data({nonSyntheticSchemaBranch:true}), c=d.scanner.candidates[0], parts=metricParts(d,c,"revenue");change(parts);
    const metric=run(d).observedPerformance.find(r=>r.candidateId===c.candidateId).metrics.revenue;
    assert.equal(metric.value,null);assert.equal(metric.sourceObservation.value,parts.raw.value);
  }
});

test("no Funnel report and no original ID cannot turn account zero into candidate zero", async () => {
  const d=await data({nonSyntheticSchemaBranch:true}); d.scanner.runContext.funnelReports=[];
  assert(run(d).observedPerformance.every(r=>r.metrics.revenue.value===null));
  const e=await data({nonSyntheticSchemaBranch:true}); const parts=metricParts(e,e.scanner.candidates[0],"revenue");
  parts.saved.report.byMeasurementId=[];parts.saved.report.sourceBatch.recordCount=0;parts.saved.report.metrics.revenue.value=0;
  assert(run(e).observedPerformance.every(r=>r.metrics.revenue.value===null));
});

test("distinct candidates cannot reuse one measurement ID as exclusive revenue", async () => {
  const d=await data({nonSyntheticSchemaBranch:true}),[a,b]=d.scanner.candidates;
  b.observedRevenueEvidence=structuredClone(a.observedRevenueEvidence);
  for(const id of Object.values(b.observedRevenueEvidence).flatMap(m=>m.evidenceRefs))if(!b.evidenceRefs.includes(id))b.evidenceRefs.push(id);
  assert(run(d).observedPerformance.every(r=>r.metrics.revenue.value===null));
});

test("high score never opens Affiliate note gate or changes saved running experiments", async () => {
  const d=await data({complete:true}),before=structuredClone(d.scanner);
  for(const row of d.context.assessments){row.purpose="AFFILIATE_NOTE_ACQUISITION";row.channel="note";}
  for(const a of run(d).assessments){
    assert.equal(a.exploration.totalScore,86);assert.equal(a.canStartExperiment,false);
    assert(a.constraints.includes("NOTE_START_REQUIRES_VERIFIED"));
    assert(a.measurementReadiness.every(m=>m.affiliateClickMeasurementStatus==="NOT_VERIFIED"&&m.canStartExperiment===false));
  }
  assert.deepEqual(d.scanner,before);
});

test("NOT_IMPLEMENTED and saved VERIFIED remain distinct; neither permits the Scorer to start an experiment", async () => {
  const d=await data({complete:true}),c=d.scanner.candidates[0],row=d.context.assessments[0],m=c.measurementReadiness[0];
  row.purpose="AFFILIATE_NOTE_ACQUISITION";row.channel="note";
  m.affiliateClickMeasurementStatus="NOT_IMPLEMENTED";
  assert.equal(assessmentFor(run(d),c.candidateId).measurementReadiness[0].affiliateClickMeasurementStatus,"NOT_IMPLEMENTED");
  const proof=verified({targetLP:m.targetLP,verifiedPageHash:c.availableLPs[0].repositoryPageHash});proof.evidence.targetLP=m.targetLP;
  const sourceFileHash=hash(proof),evidenceId=hash("SYNTHETIC saved proof");
  d.scanner.inputs.push({sourceId:"proof",sourceType:"measurement_records",sourceFileHash,isSynthetic:true,state:"LOADED"});
  d.scanner.evidence.push({evidenceId,sourceId:"proof",sourceFileHash,value:proof,metricOrClaim:"lp_measurement_record",evidenceType:"FACT",isSynthetic:true,retrievedAt:null,periodStart:null,periodEnd:null});
  c.evidenceRefs.push(evidenceId);m.affiliateClickMeasurementStatus="VERIFIED";m.evidenceId=proof.evidenceId;m.evidenceRefs=[evidenceId];
  const a=assessmentFor(run(d),c.candidateId);
  assert.equal(a.measurementReadiness[0].affiliateClickMeasurementStatus,"VERIFIED");
  assert.equal(a.exploration.totalScore,86);assert.equal(a.canStartExperiment,false);assert.equal(a.requiresStartTimeRevalidation,true);
  assert(!a.constraints.includes("NOTE_START_REQUIRES_VERIFIED"));
  delete m.evidenceRefs;assert.throws(()=>run(d),/proof/);
});

test("source freshness is re-evaluated at scorer asOf, not trusted from the old Scanner label", async () => {
  const d=await data({complete:true});
  for(const row of d.context.assessments)row.applicablePeriod.end="2026-12-31";
  const later=run(d,{asOf:"2026-12-01T00:00:00Z"});
  assert(later.assessments.every(a=>a.components.demand.value===null&&a.components.demand.missingReason==="STALE_EVIDENCE"));
  assert(d.scanner.evidence.filter(e=>e.metricOrClaim==="monthlySearches").every(e=>e.freshness.status==="WITHIN_POLICY"));
});

test("observed Approved Revenue zero and pending Revenue remain separate snapshot facts", async () => {
  const d=await data({nonSyntheticSchemaBranch:true}),c=d.scanner.candidates[0],parts=metricParts(d,c,"approvedRevenue");
  parts.raw.value=0;parts.original.value=0;parts.evidence.value=0;
  const r=run(d).observedPerformance.find(r=>r.candidateId===c.candidateId);
  assert.equal(r.metrics.approvedRevenue.value,0);assert.equal(r.metrics.approvedRevenue.evidenceType,"FACT");
  assert.equal(r.metrics.revenue.value,200);assert.equal(r.metrics.approvedRevenue.final,false);
  assert.equal(r.metrics.conversions.value,null);assert.equal(r.metrics.epc.value,null);
});

test("FAILED/INCONCLUSIVE/KILL and counter evidence survive without a new experiment decision", async () => {
  const d=await data(),c=d.scanner.candidates[0];
  c.relatedExperiments[0].status="FAILED";c.relatedExperiments[0].decision="KILL";c.relatedExperiments[0].result="FAILED";
  c.counterEvidence=["SYNTHETIC counter evidence retained"];const before=structuredClone(d.scanner);
  const a=assessmentFor(run(d),c.candidateId);
  assert.equal(a.relatedExperiments[0].status,"FAILED");assert.equal(a.relatedExperiments[0].decision,"KILL");
  assert.deepEqual(a.counterEvidence,c.counterEvidence);assert(a.constraints.includes("WHY_REVISIT_REQUIRES_NEW_EVIDENCE"));
  assert.equal(a.canStartExperiment,false);assert.deepEqual(d.scanner,before);
});
