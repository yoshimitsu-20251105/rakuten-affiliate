import test from "node:test";
import assert from "node:assert/strict";
import { POLICY, RETRY_STATES, scope, scopeCovers, emptyLedger, validateCondition, validateProposal } from "../../learning-engine/model.js";
import { validateManifest } from "../../learning-engine/sources.js";
import { buildReview } from "../../learning-engine/learning.js";
import { base, readFixture, IMPORTED_AT } from "./learning-engine-helpers.js";

test("Learning fixed policy uses exactly SATISFIED / NOT_SATISFIED / UNKNOWN", () => {
  assert.deepEqual(RETRY_STATES, ["SATISFIED", "NOT_SATISFIED", "UNKNOWN"]); assert.equal(POLICY.automatedActions, false); assert.equal(POLICY.revenueImputation, false);
});
test("null scope is never a matching wildcard", () => {
  assert.equal(scopeCovers(scope(), scope({ channel: "note" })), false);
  assert.equal(scopeCovers(scope({ channel: "note" }), scope({ channel: "note" })), true);
  assert.throws(() => scope({ experimentIds: [] })); assert.throws(() => scope({ targetLP: "https://example.test/?utm_source=x" }));
});
test("native note purpose, unknown source type, duplicate source IDs fail closed", () => {
  const m = base().manifest;
  assert.throws(() => emptyLedger("NOTE_NATIVE_MONETIZATION")); assert.throws(() => validateManifest({ ...m, purpose: "NOTE_NATIVE_MONETIZATION" }));
  assert.throws(() => validateManifest({ ...m, sources: [...m.sources, m.sources[0]] }));
  assert.throws(() => validateManifest({ ...m, sources: [{ ...m.sources[0], sourceType: "live_api" }] }));
});
test("retry condition accepts only fixed predicates and real dates", async () => {
  const c = (await readFixture("review")).learnings[0].retryConditions[0]; validateCondition(c);
  assert.throws(() => validateCondition({ ...c, predicate: "eval(code)" }));
  assert.throws(() => validateCondition({ ...c, expectedValue: { ...c.expectedValue, after: "2026-02-30T00:00:00Z" } }));
  assert.throws(() => validateCondition({ ...c, type: "AUTO_SCALE" }));
});
test("proposal rejects invented start flags and native note", async () => {
  const p = await readFixture("proposal"); validateProposal(p);
  assert.throws(() => validateProposal({ ...p, canStartExperiment: true }));
  assert.throws(() => validateProposal({ ...p, purpose: "NOTE_NATIVE_MONETIZATION" }));
});
test("accepted hypothesis stays HYPOTHESIS; result and falsification stay separate", async () => {
  const b = base(), review = await readFixture("review");
  const additions = buildReview(b.ledger, review, { recordedAt: IMPORTED_AT });
  assert.equal(additions.learnings[0].claim.evidenceType, "HYPOTHESIS");
  assert.equal(additions.learnings[0].falsification.status, "INCONCLUSIVE");
  assert.deepEqual(additions.decisions.map((d) => d.decision), ["KILL", "IMPROVE", "HOLD", "SCALE"]);
  assert.equal(b.ledger.experimentSnapshots[0].result, "FAILED"); assert.equal(b.ledger.experimentSnapshots[0].decision, "IMPROVE");
});
test("FACT must match a literal observation and its scope", async () => {
  const b = base(), review = await readFixture("review"), l = review.learnings[0];
  const old = b.ledger.evidence.find((e) => e.observedAt === "2026-10-10");
  l.claim = { text: "Observed exposure 0 at recorded review", metricOrClaim: old.metricOrClaim, value: 0, evidenceType: "FACT" }; l.evidenceRefs = [old.recordId];
  assert.equal(buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }).learnings[0].claim.value, 0);
  l.claim.value = 1; assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
  l.claim.value = 0; l.scope.channel = "note"; assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
});
test("UNKNOWN cannot become zero or lack its missingReason", async () => {
  const b = base(), review = await readFixture("review"), l = review.learnings[0];
  l.claim = { text: "Unknown revenue", metricOrClaim: "revenue", value: 0, evidenceType: "UNKNOWN", missingReason: "NOT_ATTRIBUTABLE" };
  assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
  l.claim.value = null; assert.equal(buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }).learnings[0].claim.value, null);
  delete l.claim.missingReason; assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
});
test("review cannot manufacture financial FACTs or measurement overrides", async () => {
  const b = base({ nonSyntheticSchemaBranch: true }), review = await readFixture("review"); review.isSynthetic = false;
  review.learnings[0].claim = { text: "Claimed revenue", metricOrClaim: "revenue", value: 100, evidenceType: "FACT" };
  review.learnings[0].evidenceRefs = [b.ledger.evidence[0].recordId];
  assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
  review.learnings[0].claim.evidenceType = "HYPOTHESIS"; review.learnings[0].affiliateClickMeasurementStatus = "VERIFIED";
  assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }));
});
test("review requires explicit confirmation, existing refs, and valid retry declarations", async () => {
  const b = base(), review = await readFixture("review");
  for (const key of ["reviewedBy", "confirmationReference"]) {
    const bad = structuredClone(review); delete bad[key]; assert.throws(() => buildReview(b.ledger, bad, { recordedAt: IMPORTED_AT }));
  }
  const unknown = structuredClone(review); unknown.learnings[0].evidenceRefs = ["missing"]; assert.throws(() => buildReview(b.ledger, unknown, { recordedAt: IMPORTED_AT }));
  const bad = structuredClone(review); bad.decisions[0].retryPolicy.mode = "CONDITIONAL"; bad.learnings[0].retryConditions = [];
  assert.throws(() => buildReview(b.ledger, bad, { recordedAt: IMPORTED_AT }));
});
test("historical review cannot cite a later observation, even if imported before recording the review", async () => {
  const b = base(), review = await readFixture("review");
  review.learnings[0].evidenceRefs = [b.ledger.evidence.find((e) => e.observedAt === "2026-10-21").recordId];
  assert.throws(() => buildReview(b.ledger, review, { recordedAt: IMPORTED_AT }), /after the stated review/);
});
