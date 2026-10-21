import test from "node:test";
import assert from "node:assert/strict";
import { compareObservedPerformance } from "../../opportunity-scorer/comparison.js";
import { data, run, hasKey, assessmentFor } from "./opportunity-scorer-helpers.js";

test("observed comparison uses Approved Revenue then Revenue, not exploration points", async () => {
  const d=await data({nonSyntheticSchemaBranch:true,complete:true});
  d.context.assessments[0].components.purchaseIntent.value=0;
  const result=run(d);
  const highRevenue=result.observedPerformance.find(r=>r.metrics.approvedRevenue.value===200);
  const lowRevenue=result.observedPerformance.find(r=>r.metrics.approvedRevenue.value===100);
  assert.equal(highRevenue.performanceRank,1);assert.equal(lowRevenue.performanceRank,2);
  assert.equal(assessmentFor(result,highRevenue.candidateId).explorationRank,2);
  assert.equal(assessmentFor(result,lowRevenue.candidateId).explorationRank,1);
  assert(!hasKey(result,"finalRank"));
});

test("changing performance value cannot change exploration and changing points cannot change performance", async () => {
  const d=await data({nonSyntheticSchemaBranch:true,complete:true}),before=run(d);
  const copy=structuredClone(d);
  for(const candidate of copy.scanner.candidates)for(const metric of Object.values(candidate.observedRevenueEvidence))if(metric.value!==null)metric.value=999;
  const after=run(copy);
  assert.deepEqual(after.assessments.map(r=>r.exploration),before.assessments.map(r=>r.exploration));
  assert.deepEqual(after.assessments.map(r=>r.explorationRank),before.assessments.map(r=>r.explorationRank));
  d.context.assessments[0].components.purchaseIntent.value=35;
  assert.deepEqual(run(d).observedPerformance,before.observedPerformance);
});

test("null Approved Revenue cannot be bypassed by known Revenue or EPC", async () => {
  const d=await data({nonSyntheticSchemaBranch:true}),c=d.scanner.candidates[0];
  c.observedRevenueEvidence.approvedRevenue.value=null;
  const r=run(d).observedPerformance.find(row=>row.candidateId===c.candidateId);
  assert.equal(r.metrics.revenue.value,200);assert.equal(r.performanceRank,null);
  assert(r.comparisonReasons.includes("APPROVED_REVENUE_NOT_COMPARABLE"));
});

test("equal Approved Revenue ties when Revenue is missing: UNKNOWN is not a zero tie-break", async () => {
  const rows=run(await data({nonSyntheticSchemaBranch:true})).observedPerformance;
  for(const r of rows){r.comparisonGroup=null;r.performanceRank=null;r.comparisonReasons=[];r.metrics.approvedRevenue.value=100;}
  rows[0].metrics.revenue.value=null;
  compareObservedPerformance(rows);
  assert.deepEqual(rows.map(r=>r.performanceRank),[1,1]);
  assert(rows.every(r=>JSON.stringify(r.comparisonDepth)==='["approvedRevenue"]'));
});

test("period, currency, population, snapshot, grain or unknown region mismatch prevents common ranking", async () => {
  for(const change of [
    c=>{c.period={start:"2026-09-01",end:"2026-09-30"};},c=>{c.currency="USD";},c=>{c.accountScopeId="other";},
    c=>{c.snapshotAsOf="2026-10-19T00:00:00Z";},c=>{c.grain="ACCOUNT";},c=>{c.timezone="UTC";},
    c=>{c.coverage="PARTIAL";},c=>{c.country=null;},c=>{c.observedThrough=null;},
  ]){
    const rows=run(await data({nonSyntheticSchemaBranch:true})).observedPerformance;
    for(const r of rows){r.comparisonGroup=null;r.performanceRank=null;r.comparisonReasons=[];}
    change(rows[0].metrics.approvedRevenue.context);
    compareObservedPerformance(rows);
    assert(rows.every(r=>r.performanceRank===null));
  }
});

test("complete exploration ties, incomplete assessments remain unranked without moving to the bottom", async () => {
  const d=await data({nonSyntheticSchemaBranch:true,complete:true});
  const full=run(d);
  assert(full.assessments.every(r=>r.exploration.totalScore===86&&r.explorationRank===1));
  d.context.assessments[0].components.offerFit.value=null;
  const result=run(d);
  assert.equal(assessmentFor(result,d.context.assessments[0].candidateId).explorationRank,null);
  assert.equal(assessmentFor(result,d.context.assessments[0].candidateId).exploration.totalScore,null);
  assert(result.assessments.every(r=>r.explorationRank===null)); // only one comparable peer
});

test("exploration scope/channel mismatch and unknown region do not share a comparison group", async () => {
  for(const change of [r=>{r.scope="another comparison";},r=>{r.channel="note";},r=>{r.scope=null;}]){
    const d=await data({nonSyntheticSchemaBranch:true,complete:true});change(d.context.assessments[0]);
    assert(run(d).assessments.every(r=>r.explorationRank===null));
  }
  const d=await data({nonSyntheticSchemaBranch:true,complete:true});
  d.scanner.candidates[0].country=null;d.context.assessments[0].country=null;
  assert(run(d).assessments.every(r=>r.explorationRank===null));
});

test("synthetic is never mixed into real comparison, while component arithmetic remains visible", async () => {
  const result=run(await data({complete:true}));
  assert(result.assessments.every(r=>r.exploration.totalScore===86&&r.explorationRank===null));
  assert(result.observedPerformance.every(r=>r.performanceRank===null));
});

test("recomparison clears an earlier rank when the primary observation becomes missing", async () => {
  const rows=run(await data({nonSyntheticSchemaBranch:true})).observedPerformance;
  assert.equal(rows[0].performanceRank,1);
  rows[0].metrics.approvedRevenue.value=null;
  compareObservedPerformance(rows);
  assert.equal(rows[0].performanceRank,null);assert.equal(rows[0].comparisonGroup,null);
  assert.deepEqual(rows[0].comparisonDepth,[]);
});
