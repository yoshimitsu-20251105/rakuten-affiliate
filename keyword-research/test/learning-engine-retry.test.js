import test from "node:test";
import assert from "node:assert/strict";
import { scope } from "../../learning-engine/model.js";
import { evaluateCondition, aggregateConditions, reviewProposal, measurementForProposal, matchScope } from "../../learning-engine/retry.js";
import { reviewed, base, addEvidence, AS_OF, IMPORTED_AT, targetLP, pageHash, verified } from "./learning-engine-helpers.js";

test("required condition tri-state aggregation never treats an empty set as satisfied", () => {
  const c = (status, required = true) => ({ status, required });
  assert.equal(aggregateConditions([]), "UNKNOWN"); assert.equal(aggregateConditions([c("SATISFIED", false)]), "UNKNOWN");
  assert.equal(aggregateConditions([c("SATISFIED"), c("UNKNOWN")]), "UNKNOWN");
  assert.equal(aggregateConditions([c("NOT_SATISFIED"), c("UNKNOWN")]), "NOT_SATISFIED");
  assert.equal(aggregateConditions([c("SATISFIED"), c("UNKNOWN", false)]), "SATISFIED");
  assert.throws(() => aggregateConditions([c("MET")]));
});
test("new scoped observation satisfies condition, old observation does not", async () => {
  const b = await reviewed(), c = b.review.learnings[0].retryConditions[0];
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "SATISFIED");
  const old = b.ledger.evidence.find((e) => e.observedAt === "2026-10-10"); b.proposal.newEvidenceRefs = [old.recordId];
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "NOT_SATISFIED");
});
test("missing, future, wrong-scope and stale observations never satisfy retries", async () => {
  const b = await reviewed(), c = b.review.learnings[0].retryConditions[0]; b.proposal.newEvidenceRefs = [];
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  const future = addEvidence(b.ledger, { metricOrClaim: c.expectedValue.metric, observedAt: "2026-10-23" }); b.proposal.newEvidenceRefs = [future.evidence.recordId];
  assert.equal(evaluateCondition(c, b.proposal, future.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  const other = addEvidence(b.ledger, { metricOrClaim: c.expectedValue.metric, scope: scope({ channel: "note", targetLP }) }); b.proposal.newEvidenceRefs = [other.evidence.recordId];
  assert.equal(evaluateCondition(c, b.proposal, other.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  b.proposal.newEvidenceRefs = [b.fresh.recordId]; c.expectedValue.maxAgeDays = 0;
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "NOT_SATISFIED");
});
test("same-day imprecise evidence is UNKNOWN and import time never refreshes observation", async () => {
  const b = await reviewed(), c = b.review.learnings[0].retryConditions[0]; c.expectedValue.after = "2026-10-21T00:00:00Z";
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  c.expectedValue.after = "2026-10-22T00:00:00Z";
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "NOT_SATISFIED");
});
test("satisfied conditions remain advisory; no experiment start or decision execution", async () => {
  const b = await reviewed(), r = reviewProposal(b.ledger, b.proposal, { asOf: AS_OF });
  const match = r.matches.find((x) => x.kind === "LEARNING");
  assert.equal(match.retryStatus, "SATISFIED"); assert.equal(match.reason, "CONDITIONS_SATISFIED_REVIEW_REQUIRED"); assert.equal(r.canStartExperiment, false);
  assert.equal(b.ledger.experimentSnapshots[0].decision, "IMPROVE"); assert.equal(b.ledger.experimentSnapshots[0].status, "FAILED");
});
test("WHY_REVISIT text alone, no new proof, or missing whatChanged is insufficient", async () => {
  const b = await reviewed(); delete b.proposal.whatChanged;
  let r = reviewProposal(b.ledger, b.proposal, { asOf: AS_OF }); assert.equal(r.matches.find((x) => x.kind === "LEARNING").retryStatus, "UNKNOWN");
  b.proposal.whatChanged = "Claim only"; b.proposal.newEvidenceRefs = [];
  r = reviewProposal(b.ledger, b.proposal, { asOf: AS_OF }); assert.equal(r.matches.find((x) => x.kind === "LEARNING").reason, "RETRY_REVIEW_INCOMPLETE");
});
test("scope matching distinguishes nulls and channel changes; overlap does not stop RUNNING", async () => {
  const b = await reviewed(); const old = b.ledger.learnings[0].scope;
  assert.equal(matchScope(old, { targetLP, channel: null }, ["synthetic-exp"]), "POSSIBLE_MATCH");
  assert.equal(matchScope(old, { targetLP, channel: "note" }, ["synthetic-exp"]), "POSSIBLE_MATCH");
  assert.equal(matchScope(old, { targetLP: "https://other.test/", channel: "note" }), "NO_MATCH");
  const running = base({ experimentOverrides: { status: "RUNNING", result: null, decision: null } });
  const p = { ...b.proposal, relatedExperimentIds: [], purpose: "AFFILIATE_NOTE_ACQUISITION", scope: { targetLP, channel: "note" } };
  const r = reviewProposal(running.ledger, p, { asOf: AS_OF }); assert(r.flags.includes("ACTIVE_EXPERIMENT_OVERLAP"));
  assert.equal(running.ledger.experimentSnapshots[0].status, "RUNNING");
});
test("current saved proof is verified only with matching HTML/property and window", async () => {
  const b = await reviewed(); const added = addEvidence(b.ledger, { metricOrClaim: "lp_measurement", value: verified(), scope: scope({ targetLP }) });
  const p = { ...b.proposal, purpose: "AFFILIATE_NOTE_ACQUISITION", measurement: { evidenceRef: added.evidence.recordId, htmlPath: "local.html", ga4PropertyReference: "synthetic-property" } };
  const context = { asOf: AS_OF, measurementContext: { currentPageHash: pageHash } };
  assert.equal(measurementForProposal(added.ledger, p, context).affiliateClickMeasurementStatus, "VERIFIED");
  assert.equal(measurementForProposal(added.ledger, p, { ...context, measurementContext: { currentPageHash: "0".repeat(64) } }).affiliateClickMeasurementStatus, "NOT_VERIFIED");
  p.measurement.ga4PropertyReference = "other-property";
  assert.equal(measurementForProposal(added.ledger, p, context).affiliateClickMeasurementStatus, "NOT_VERIFIED");
});
test("VERIFIED proof does not authorize a start; missing proof keeps note gate closed", async () => {
  const b = await reviewed(); b.proposal.purpose = "AFFILIATE_NOTE_ACQUISITION";
  const r = reviewProposal(b.ledger, b.proposal, { asOf: AS_OF });
  assert.equal(r.canStartExperiment, false); assert.equal(r.measurement.affiliateClickMeasurementStatus, "NOT_VERIFIED"); assert(r.flags.includes("AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET"));
  const a = addEvidence(b.ledger, { metricOrClaim: "lp_measurement", value: verified(), scope: scope({ targetLP }) });
  b.proposal.measurement = { evidenceRef: a.evidence.recordId, htmlPath: "local.html", ga4PropertyReference: "synthetic-property" };
  const good = reviewProposal(a.ledger, b.proposal, { asOf: AS_OF, measurementContext: { currentPageHash: pageHash } });
  assert.equal(good.measurement.affiliateClickMeasurementStatus, "VERIFIED"); assert.equal(good.canStartExperiment, false); assert.equal(good.requiresStartTimeRevalidation, true);
});
test("expired/invalidated proofs and newer registered records cannot be bypassed by selecting old proof", async () => {
  const b = await reviewed(), invalid = addEvidence(b.ledger, { metricOrClaim: "lp_measurement", value: verified({ invalidatedAt: "2026-10-21T00:00:00Z" }), scope: scope({ targetLP }) });
  const p = { ...b.proposal, measurement: { evidenceRef: invalid.evidence.recordId, htmlPath: "local.html", ga4PropertyReference: "synthetic-property" } };
  const context = { asOf: AS_OF, measurementContext: { currentPageHash: pageHash } };
  assert.equal(measurementForProposal(invalid.ledger, p, context).affiliateClickMeasurementStatus, "NOT_VERIFIED");
  const old = addEvidence(b.ledger, { metricOrClaim: "lp_measurement", value: verified(), scope: scope({ targetLP }) });
  const newer = addEvidence(old.ledger, { metricOrClaim: "lp_measurement", value: { targetLP, affiliateClickMeasurementStatus: "NOT_IMPLEMENTED" }, scope: scope({ targetLP }) }, { recordedAt: "2026-10-22T01:00:00Z" });
  p.measurement.evidenceRef = old.evidence.recordId;
  assert.equal(measurementForProposal(newer.ledger, p, context).reason, "NEWER_REGISTERED_MEASUREMENT_RECORD");
  p.measurement.evidenceRef = newer.evidence.recordId;
  assert.equal(measurementForProposal(newer.ledger, p, context).affiliateClickMeasurementStatus, "NOT_IMPLEMENTED");
});
test("measurement condition evaluates the existing gate, with all three retry states", async () => {
  const b = await reviewed(), c = { conditionId: "measure", type: "MEASUREMENT_VERIFIED", predicate: "VALID_AT_REVIEW", required: true,
    expectedValue: {}, scope: { targetLP }, evidenceRefs: [], reason: "Measurement required" };
  for (const [affiliateClickMeasurementStatus, expected] of [["VERIFIED", "SATISFIED"], ["NOT_VERIFIED", "UNKNOWN"], ["NOT_IMPLEMENTED", "NOT_SATISFIED"]]) {
    const result = evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF, measurement: { affiliateClickMeasurementStatus } }); assert.equal(result.status, expected);
  }
});
test("changed-variable declarations need matching before and after evidence", async () => {
  const b = await reviewed(), c = { conditionId: "title", type: "CHANGED_VARIABLE", predicate: "DECLARED_CHANGE", required: true,
    expectedValue: { field: "titlePattern", from: "old", to: "new" }, scope: { targetLP }, evidenceRefs: [], reason: "Document change" };
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  const before = addEvidence(b.ledger, { metricOrClaim: "titlePattern", value: "old" });
  const after = addEvidence(before.ledger, { metricOrClaim: "titlePattern", value: "new" });
  b.proposal.changes = [{ field: "titlePattern", from: "old", to: "new", evidenceRefs: [before.evidence.recordId, after.evidence.recordId], reason: "Evidence-backed proposal" }];
  b.proposal.scope.titlePattern = "new";
  assert.equal(evaluateCondition(c, b.proposal, after.ledger, { asOf: AS_OF }).status, "SATISFIED");
});
test("elapsed time does not prove complete observation or approved revenue finality", async () => {
  const b = await reviewed(), c = { conditionId: "window", type: "OBSERVATION_WINDOW", predicate: "COMPLETE_THROUGH", required: true,
    expectedValue: { endDate: "2026-10-21", periodStart: "2026-10-01", final: true }, scope: { targetLP }, evidenceRefs: [], reason: "Observe complete period" };
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: "2026-10-20T00:00:00Z" }).status, "NOT_SATISFIED");
  const e = addEvidence(b.ledger, { period: { start: "2026-10-01", end: "2026-10-21" }, observedThrough: "2026-10-21", sourceObservation: { coverage: "COMPLETE", final: true } });
  b.proposal.newEvidenceRefs = [e.evidence.recordId]; assert.equal(evaluateCondition(c, b.proposal, e.ledger, { asOf: AS_OF }).status, "SATISFIED");
});
test("manual confirmation needs named reviewer, known proof and scope", async () => {
  const b = await reviewed(), c = { conditionId: "confirm", type: "REVIEW_CONFIRMATION", predicate: "REVIEWED", required: true,
    expectedValue: { reviewer: "reviewer-1" }, scope: { targetLP }, evidenceRefs: [], reason: "Review source" };
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  b.proposal.confirmations = [{ conditionId: "confirm", reviewedBy: "reviewer-1", reviewedAt: IMPORTED_AT, evidenceRefs: [b.fresh.recordId], reference: "explicit manual review", scope: { targetLP } }];
  assert.equal(evaluateCondition(c, b.proposal, b.ledger, { asOf: AS_OF }).status, "SATISFIED");
});
test("no match is not permission, and references cannot cross synthetic boundaries", async () => {
  const b = await reviewed(); b.proposal.relatedExperimentIds = []; b.proposal.scope = { targetLP: "https://unrelated.test/" };
  const r = reviewProposal(b.ledger, b.proposal, { asOf: AS_OF }); assert.equal(r.status, "NO_MATCH_FOUND"); assert.equal(r.canStartExperiment, false);
  b.proposal.isSynthetic = false; assert.throws(() => reviewProposal(b.ledger, b.proposal, { asOf: AS_OF }));
});
