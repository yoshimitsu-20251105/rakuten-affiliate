import test from "node:test";
import assert from "node:assert/strict";
import { setup, run, currentProof, currentRegistry, active, classify, AS_OF, PAGE_HASH, HTML, refresh, bytes } from "./acquisition-planner-helpers.js";
import { verified, base, readFixture } from "./learning-engine-helpers.js";
import { run as selectorRun } from "./experiment-selector-helpers.js";
import { append } from "../../learning-engine/store.js";
import { buildImport } from "../../learning-engine/sources.js";
import { buildReview } from "../../learning-engine/learning.js";
import { hash } from "../../acquisition-planner/model.js";
import { GROUP } from "../../experiment-selector/policy.js";
import { OPERATIONS } from "../../acquisition-planner/model.js";

test("Fresh verified note plan is READY while all action flags remain false", async () => {
  const b = await setup({ channel: "note" }), r = run(b), p = r.plans[0];
  assert.equal(r.planStatus, "READY"); assert.equal(p.affiliateClickMeasurementStatus, "VERIFIED"); assert.equal(p.affiliateNotePostPlan.publishedAt, null); assert.equal(p.affiliateNotePostPlan.postUrl, null);
  for (const obj of [r, p, p.affiliateNotePostPlan]) for (const k of Object.keys(OPERATIONS)) assert.equal(obj[k], false, k);
});
for (const status of ["NOT_VERIFIED", "NOT_IMPLEMENTED"]) test(`New note current status ${status} is always BLOCKED`, async () => {
  const b = await setup({ channel: "note" }), p = b.current.selectionContext.proposals[0];
  currentProof(b, { targetLP: p.targetLP, affiliateClickMeasurementStatus: status });
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].affiliateClickMeasurementStatus, status); assert(r.blockingReasons.some((r) => r.code === "AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET"));
});
test("HTML drift after original recommendation blocks every channel without updating fixed variables", async () => {
  for (const channel of ["x", "note", "organic_search"]) {
    const b = await setup({ channel }), p = b.original.selectionContext.proposals[0]; b.current.html[p.proposalId] = HTML + "<!-- changed -->";
    const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "FIXED_VARIABLE_DRIFT")); assert.equal(r.plans[0].fixedVariables.pageHash, PAGE_HASH);
  }
});
test("Current note receipt evidence missing is an invalid proof, never READY", async () => {
  const b = await setup({ channel: "note" }), p = b.current.selectionContext.proposals[0], proof = verified({ targetLP: p.targetLP, verifiedPageHash: PAGE_HASH,
    evidence: { ...verified().evidence, targetLP: p.targetLP, received: false } });
  assert.throws(() => currentProof(b, proof));
});
test("Expired current note proof blocks even when original Selector was VERIFIED", async () => {
  const b = await setup({ channel: "note" }), p = b.current.selectionContext.proposals[0];
  const m = verified({ targetLP: p.targetLP, verifiedPageHash: PAGE_HASH, evidence: { ...verified().evidence, targetLP: p.targetLP }, applicablePeriod: { start: "2026-10-01", end: "2026-10-21" } });
  currentProof(b, m); const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].measurementVerification.originalStatus, "VERIFIED"); assert.equal(r.plans[0].affiliateClickMeasurementStatus, "NOT_VERIFIED");
});
test("Planner cannot return to old proof when a newer registered proof invalidates it", async () => {
  const b = await setup({ channel: "note" }), p = b.current.selectionContext.proposals[0], old = structuredClone(p.measurement);
  currentProof(b, { targetLP: p.targetLP, affiliateClickMeasurementStatus: "NOT_IMPLEMENTED" }); p.measurement = old;
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].measurementVerification.effective.reason, "NEWER_REGISTERED_MEASUREMENT_RECORD");
});
test("Same monetization group capacity becoming full blocks the old recommendation", async () => {
  const b = await setup(), e = active(); await currentRegistry(b, [e]); classify(b.current, e, "AFFILIATE_ACQUISITION", GROUP);
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].concurrencyReview.runningCount, 1); assert.equal(r.selectedProposalId, b.selectorReport.selectedProposal.proposalId);
});
test("Unknown RUNNING class or missing limit gives manual review, not zero count", async () => {
  const b = await setup(); await currentRegistry(b, [active()]); const r = run(b);
  assert.equal(r.planStatus, "MANUAL_REVIEW_REQUIRED"); assert.equal(r.plans[0].concurrencyReview.runningCount, null);
  const n = await setup(); delete n.current.selectionContext.policy.maxConcurrentMonetizationExperiments; assert.equal(run(n).planStatus, "MANUAL_REVIEW_REQUIRED");
});
test("Nonrevenue RUNNING does not consume monetization capacity", async () => {
  const b = await setup(), e = active(); await currentRegistry(b, [e]); classify(b.current, e, "SEO");
  const r = run(b); assert.equal(r.planStatus, "READY"); assert.equal(r.plans[0].concurrencyReview.runningCount, 0);
});
test("Quota-exempt SEO on the same LP still blocks interference", async () => {
  const b = await setup(), e = active({ targetUrls: [b.planningContext.plan.targetLP] }); await currentRegistry(b, [e]); classify(b.current, e, "SEO");
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].concurrencyReview.runningCount, 0); assert(r.blockingReasons.some((r) => r.code === "RUNNING_LP_OR_MEASUREMENT_INTERFERENCE"));
});
test("Stale Selector and required scoped confirmations prevent READY", async () => {
  const b = await setup(); b.planningContext.policy.maxSelectorAgeDays = 0;
  assert(run(b).blockingReasons.some((r) => r.code === "SELECTOR_RECOMMENDATION_STALE"));
  const n = await setup(); n.planningContext.checklistConfirmations[0].pageHash = "0".repeat(64); assert.equal(run(n).planStatus, "MANUAL_REVIEW_REQUIRED");
});
test("Unavailable campaign grain is blocked, unknown grain requires review", async () => {
  for (const [state, expected] of [["FAIL", "BLOCKED"], ["UNKNOWN", "MANUAL_REVIEW_REQUIRED"]]) {
    const b = await setup(); b.planningContext.checklistConfirmations[0].status = state; assert.equal(run(b).planStatus, expected);
  }
});
test("Changing selected channel or experiment metadata cannot expand a recommendation", async () => {
  const b = await setup(); b.planningContext.plan.channel = "note"; assert.equal(run(b).planStatus, "BLOCKED");
  const n = await setup(); n.planningContext.plan.contentPattern = "ranking";
  const r = run(n); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "SELECTED_PROTOCOL_MODIFIED"));
});
test("Original counter evidence review is rechecked rather than trusted from saved success", async () => {
  const b = await setup({ counterEvidence: true }); assert.equal(run(b).planStatus, "READY"); delete b.current.selectionContext.proposals[0].historyReview;
  const r = run(b); assert.equal(r.planStatus, "MANUAL_REVIEW_REQUIRED"); assert(r.blockingReasons.some((r) => r.code === "COUNTER_EVIDENCE_REVIEW_REQUIRED")); assert(r.plans[0].counterEvidence.length);
});
test("FAILED+IMPROVE may be planned with satisfied retry; a new required condition blocks without executing a judgment", async () => {
  const b = await setup(), p = b.original.selectionContext.proposals[0], h = base({ nonSyntheticSchemaBranch: true, experimentOverrides: { targetUrls: [p.targetLP], trafficSource: p.channel } });
  const review = await readFixture("review"); review.isSynthetic = false; review.decisions = [];
  const l = review.learnings[0]; l.scope.targetLP = p.targetLP; l.scope.channel = p.channel; l.retryConditions[0].scope.targetLP = p.targetLP; l.retryConditions[0].scope.channel = p.channel;
  h.ledger = append(h.ledger, buildReview(h.ledger, review, { recordedAt: "2026-10-22T00:00:00Z" })).ledger;
  const spec = h.loaded[0].spec, data = h.loaded[0].data, manifest = { schemaVersion: 1, purpose: b.purpose, sources: [spec], links: [] };
  h.ledger = append(h.ledger, buildImport(manifest, [{ spec, data, sourceFileHash: hash(bytes(data)) }], { recordedAt: "2026-10-22T00:00:00Z" })).ledger;
  b.original.experimentsSnapshot = data; b.original.learningLedger = h.ledger; p.relatedExperimentIds = ["synthetic-exp"]; p.WHY_REVISIT = "SYNTHETIC new scoped evidence"; p.whatChanged = "SYNTHETIC new observation";
  p.newEvidenceRefs = [h.ledger.evidence.find((e) => e.observedAt === "2026-10-21").recordId]; b.selectorReport = selectorRun(b.original);
  b.current.experimentsSnapshot = structuredClone(data); b.current.learningLedger = structuredClone(h.ledger); b.current.selectionContext = structuredClone(b.original.selectionContext);
  assert.equal(run(b).planStatus, "READY"); assert.equal(b.current.experimentsSnapshot.items[0].status, "FAILED"); assert.equal(b.current.experimentsSnapshot.items[0].decision, "IMPROVE");
  const revision = structuredClone(review); revision.reviewId = "new-current-review"; revision.reviewedAt = "2026-10-22T06:15:00Z";
  revision.learnings[0].revisionId = "v2"; revision.learnings[0].supersedesRevisionId = "v1"; revision.learnings[0].retryConditions[0].validFrom = "2026-10-23T00:00:00Z";
  b.current.learningLedger = append(b.current.learningLedger, buildReview(b.current.learningLedger, revision, { recordedAt: AS_OF })).ledger;
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].retryReview.status, "NOT_SATISFIED"); assert.equal(r.canStartExperiment, false);
});
test("Missing new experiment ID is manual review and existing experiment ID is blocked", async () => {
  const b = await setup(); b.planningContext.plan.experimentId = null; assert.equal(run(b).planStatus, "MANUAL_REVIEW_REQUIRED");
  const n = await setup(), e = active({ experimentId: n.planningContext.plan.experimentId, status: "STOPPED" }); await currentRegistry(n, [e]); assert.equal(run(n).planStatus, "BLOCKED");
});
test("NOTE_NATIVE_MONETIZATION cannot be smuggled through an Affiliate context", async () => {
  const b = await setup({ channel: "note" }); b.planningContext.purpose = "NOTE_NATIVE_MONETIZATION"; assert.throws(() => run(b));
});
test("Relevant observation period must fit note proof, not only the Planner date", async () => {
  const b = await setup({ channel: "note" }), p = b.original.selectionContext.proposals[0];
  p.scope.period = { start: "2026-10-01", end: "2026-11-01" }; b.selectorReport = selectorRun(b.original); b.current.selectionContext = structuredClone(b.original.selectionContext);
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].measurementVerification.effective.reason, "PERIOD_NOT_VERIFIED");
});
test("A new selection policy is not an automatic capacity increase", async () => {
  const b = await setup(); b.current.selectionContext.policy.maxConcurrentMonetizationExperiments = 99;
  const r = run(b); assert.equal(r.planStatus, "MANUAL_REVIEW_REQUIRED"); assert(r.blockingReasons.some((r) => r.code === "CURRENT_SELECTION_POLICY_CHANGED_REVIEW_REQUIRED"));
});
test("Future scoped confirmation does not satisfy current planning requirements", async () => {
  const b = await setup(); b.planningContext.checklistConfirmations[0].reviewedAt = "2026-10-23T00:00:00Z";
  assert.equal(run(b).planStatus, "MANUAL_REVIEW_REQUIRED");
});
test("Required EPC or conversions cannot be declared measurable by a verified click event alone", async () => {
  for (const [metric, status] of [["epc", "BLOCKED"], ["conversions", "MANUAL_REVIEW_REQUIRED"]]) {
    const b = await setup({ channel: "note" }), p = b.original.selectionContext.proposals[0]; p.variables.acquisition.requiredMetrics.push(metric);
    b.selectorReport = selectorRun(b.original); b.current.selectionContext = structuredClone(b.original.selectionContext); b.planningContext.plan.requiredMetrics.push(metric);
    const r = run(b); assert.equal(r.planStatus, status); assert.equal(r.plans[0].affiliateClickMeasurementStatus, "VERIFIED");
  }
});
test("A Selector proposal ID is not silently reused as a new experiment ID", async () => {
  const b = await setup(); b.planningContext.plan.experimentId = b.selectorReport.selectedProposal.proposalId;
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "PROPOSAL_ID_IS_NOT_EXPERIMENT_ID"));
});
test("Unknown approved capability metadata remains manual review, not a zero or invented default", async () => {
  const b = await setup(), p = b.original.selectionContext.proposals[0];
  for (const k of ["contentPurpose", "requiredTrafficGrain", "requiredMetrics"]) { p.variables.acquisition[k] = null; b.planningContext.plan[k] = null; }
  b.selectorReport = selectorRun(b.original); b.current.selectionContext = structuredClone(b.original.selectionContext);
  const r = run(b); assert.equal(r.planStatus, "MANUAL_REVIEW_REQUIRED"); assert(r.blockingReasons.some((r) => r.code === "REQUIRED_METRICS_NOT_DEFINED"));
});
