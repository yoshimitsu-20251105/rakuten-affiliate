import test from "node:test";
import assert from "node:assert/strict";
import { setup, run, refresh } from "./experiment-selector-helpers.js";
import { hasKey, metricParts } from "./opportunity-scorer-helpers.js";

test("Equal complete exploration scores produce zero even when Revenue differs", async () => {
  const b = await setup(), r = run(b); assert.equal(r.selectionReason, "TIED_BEST_NO_SELECTION"); assert.equal(r.recommendationCount, 0);
  assert.notEqual(r.observedPerformance[0].metrics.revenue.value, r.observedPerformance[1].metrics.revenue.value);
});
test("Unique best exploration hypothesis is at most one recommendation, never Revenue prediction", async () => {
  const b = await setup({ mutate: (d) => { d.context.assessments[0].components.purchaseIntent.value = 31; } }), r = run(b);
  assert.equal(r.recommendationCount, 1); assert.equal(r.proposals.filter((p) => p.selected).length, 1);
  assert.equal(r.proposals.find((p) => p.selected).comparison.evidenceType, "HYPOTHESIS");
  assert.equal(r.canStartExperiment, false); assert(!hasKey(r, "finalRank"));
});
test("Known partial components remain visible; unknown competitor is never scored zero or last", async () => {
  const b = await setup({ complete: false }), r = run(b);
  assert.equal(r.recommendationCount, 0); assert.equal(r.selectionReason, "COMPARISON_UNKNOWN_NO_SELECTION");
  const a = r.explorationAssessments.find((a) => a.exploration.totalScore === null);
  assert.equal(a.components.purchaseIntent.value, 30); assert.equal(a.components.offerFit.value, null); assert.equal(a.components.lpReuse.value, 20); assert.equal(a.components.demand.value, 12);
});
test("One fully comparable eligible proposal can be recommended without manufacturing peer ranks", async () => {
  const b = await setup(); b.selectionContext.proposals.pop(); const r = run(b);
  assert.equal(r.recommendationCount, 1); assert.equal(r.selectionReason, "SOLE_COMPARABLE_ELIGIBLE_PROPOSAL");
  assert.equal(r.candidates.find((c) => !c.proposals.length).rejectionReason[0], "NO_EXPLICIT_PROPOSAL_DEFINED");
});
test("Predeclared candidate scope excludes candidates with explicit reasons and provenance", async () => {
  const b = await setup(); b.selectionContext.policy.selectionScope.candidateIds = [b.selectionContext.proposals[0].candidateId]; const r = run(b);
  assert.equal(r.recommendationCount, 1); assert(r.proposals.some((p) => p.rejectionReason.includes("OUTSIDE_PREDECLARED_SELECTION_SCOPE")));
});
test("Different comparison groups require predeclared group, never ID or score-based scope selection", async () => {
  const b = await setup({ mutate: (d) => { d.context.assessments[0].scope = "SYNTHETIC different comparison universe"; } });
  assert.equal(run(b).selectionReason, "MULTIPLE_INCOMPARABLE_GROUPS_NO_SELECTION");
  b.selectionContext.policy.comparisonGroup = b.scorerReport.assessments[0].comparisonGroup;
  assert.equal(run(b).recommendationCount, 1);
});
test("Unknown group cannot be ignored to select the known predeclared group", async () => {
  const b = await setup({ complete: false }); b.selectionContext.policy.comparisonGroup = b.scorerReport.assessments.find((a) => a.comparisonGroup).comparisonGroup;
  assert.equal(run(b).recommendationCount, 0);
});
test("Stale evidence or policy outside applicable window never becomes a new zero score", async () => {
  const b = await setup(); b.selectionContext.policy.maxSnapshotAgeDays = 0;
  const r = run(b); assert.equal(r.recommendationCount, 0); assert(r.proposals.every((p) => p.comparison.reason === "SCORER_SNAPSHOT_STALE"));
  assert(r.explorationAssessments.every((a) => a.exploration.totalScore === 86));
  b.selectionContext.policy.maxSnapshotAgeDays = 3; b.selectionContext.policy.applicablePeriod.end = "2026-10-21";
  assert.equal(run(b).recommendationCount, 0);
});
test("Synthetic inputs never qualify as live market comparisons", async () => {
  const b = await setup({ realBranch: false }), r = run(b); assert.equal(r.recommendationCount, 0);
  assert(r.observedPerformance.every((p) => p.metrics.revenue.value === null));
});
test("Observed mode compares only Funnel FACT prefix and leaves conversions/EPC null", async () => {
  const b = await setup(); b.selectionContext.policy.selectionTrack = "OBSERVED_PERFORMANCE";
  for (const p of b.selectionContext.proposals) {
    p.referencePerformanceScope = b.scorerReport.observedPerformance.find((r) => r.candidateId === p.candidateId).metrics.approvedRevenue.sourceObservation.scope;
  }
  const r = run(b); assert.equal(r.recommendationCount, 1); assert.deepEqual(r.comparisonDepth, ["approvedRevenue", "revenue"]);
  assert(r.observedPerformance.every((p) => p.metrics.conversions.value === null && p.metrics.epc.value === null));
  assert(r.proposals.find((p) => p.selected).comparison.attribution.includes("NOT_PROPOSED_CHANNEL_ATTRIBUTION"));
});
test("Observed mode requires explicit exact reference scope; missing scope has no exploration fallback", async () => {
  const b = await setup(); b.selectionContext.policy.selectionTrack = "OBSERVED_PERFORMANCE"; assert.equal(run(b).recommendationCount, 0);
  for (const p of b.selectionContext.proposals) p.referencePerformanceScope = { accountScopeId: "synthetic-account", measurementId: "synthetic-id-dog", channel: "note" };
  assert.equal(run(b).recommendationCount, 0);
});
test("Null Approved Revenue cannot be replaced by known Revenue or exploration", async () => {
  const b = await setup({ mutate: (d) => {
    const c = d.scanner.candidates[0], { raw } = metricParts(d, c, "approvedRevenue"); raw.value = null; raw.evidenceType = "UNKNOWN";
  } });
  b.selectionContext.policy.selectionTrack = "OBSERVED_PERFORMANCE";
  for (const p of b.selectionContext.proposals) p.referencePerformanceScope = b.scorerReport.observedPerformance.find((r) => r.candidateId === p.candidateId).metrics.approvedRevenue.sourceObservation.scope;
  assert.equal(run(b).recommendationCount, 0);
});
test("All Revenue metrics missing does not penalize complete independent exploration", async () => {
  const b = await setup({ mutate: (d) => { for (const c of d.scanner.candidates) for (const key of ["approvedRevenue", "revenue"]) {
    c.observedRevenueEvidence[key].value = null; c.observedRevenueEvidence[key].evidenceType = "UNKNOWN";
  } } });
  b.selectionContext.proposals.pop(); const r = run(b); assert.equal(r.recommendationCount, 1);
  assert(r.observedPerformance.every((p) => Object.values(p.metrics).every((m) => m.value === null)));
});
test("Observed performance tie is not broken with a different exploration score", async () => {
  const b = await setup({ mutate: (d) => {
    d.context.assessments[0].components.purchaseIntent.value = 31;
    for (const key of ["approvedRevenue", "revenue"]) { const { raw, evidence, original } = metricParts(d, d.scanner.candidates[0], key); raw.value = 100; evidence.value = 100; original.value = 100; }
  } });
  b.selectionContext.policy.selectionTrack = "OBSERVED_PERFORMANCE";
  for (const p of b.selectionContext.proposals) p.referencePerformanceScope = b.scorerReport.observedPerformance.find((r) => r.candidateId === p.candidateId).metrics.approvedRevenue.sourceObservation.scope;
  const r = run(b); assert.equal(r.recommendationCount, 0); assert.equal(r.selectionReason, "TIED_BEST_NO_SELECTION");
});
test("Every candidate and proposal preserves all eight requested decision fields", async () => {
  const r = run(await setup());
  for (const row of [...r.candidates, ...r.proposals]) for (const key of ["eligibility", "selected", "selectionReason", "rejectionReason", "evidenceRefs", "retryStatus", "measurementGateStatus", "concurrencyStatus"]) assert(Object.hasOwn(row, key), key);
  for (const row of r.proposals) { assert(row.rejectionReason.length); assert(row.evidenceRefs.every((e) => /^[a-f0-9]{64}$/.test(e.sourceFileHash))); }
});
test("Selection is deterministic and input snapshots are not mutated", async () => {
  const b = await setup(); refresh(b); const before = JSON.stringify(b);
  const first = run(b), second = run(b); assert.deepEqual(first, second); assert.equal(JSON.stringify(b), before);
});
