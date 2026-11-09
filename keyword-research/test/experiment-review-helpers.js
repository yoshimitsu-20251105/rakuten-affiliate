import assert from "node:assert/strict";
import { hash } from "../../learning-engine/model.js";

const noteId = "exp-2026-10-13-grain-free-dog-channel-note-vs-x";
const expected = {
  [noteId]: ["INCONCLUSIVE", "HOLD"],
  "exp-2026-10-05-senior-cat-food": ["INCONCLUSIVE", "IMPROVE"],
  "exp-2026-10-05-grain-free-dog-food": ["FAILED", "IMPROVE"],
  "exp-2026-10-05-domestic-additive-free-dog-treats": ["FAILED", "IMPROVE"],
};
const fixed = ({ status, result, decision, metrics, learnings, ...rest }) => rest;

// This authorizes only the reviewed lifecycle delta. It never exempts an
// experiment definition, past metric, LP, objective, or arbitrary future close.
export function validateReviewClosures(before, after, bundle, evidence) {
  assert.equal(bundle.schemaVersion, 1);
  assert.deepEqual(bundle.closures.map(c => c.experimentId).sort(), Object.keys(expected).sort());
  assert.deepEqual(before.items.map(e => e.experimentId), after.items.map(e => e.experimentId));
  const projected = structuredClone(before);
  for (const [i, prior] of before.items.entries()) {
    const next = after.items[i], pair = expected[prior.experimentId];
    if (!pair) { assert.deepEqual(next, prior); continue; }
    const c = bundle.closures.find(c => c.experimentId === prior.experimentId);
    const r = evidence.reviews.find(r => r.experimentId === prior.experimentId);
    assert.equal(c.kind, "EXPERIMENT_CLOSURE"); assert.equal(c.authorizedBy, "user"); assert(c.authorizationReference);
    assert.equal(prior.status, "RUNNING"); assert.equal(c.fromStatus, prior.status);
    assert.equal(hash(prior), c.priorRecordHash); assert.equal(hash(next), c.finalRecordHash);
    assert.deepEqual(fixed(next), fixed(prior));
    assert.deepEqual([next.status, next.result, next.decision], [pair[0], ...pair]);
    assert.deepEqual([c.toStatus, c.result, c.decision], [pair[0], ...pair]);
    assert.deepEqual(next.metrics, [...prior.metrics, ...c.appendedMetrics]);
    assert.deepEqual(next.learnings, [...prior.learnings, ...c.appendedLearnings]);
    assert.deepEqual(c.period, { start: prior.startDate, end: prior.reviewDate });
    assert.deepEqual(c.actions, { closeExistingExperiment: true, startNewExperiment: false, publish: false, post: false });
    assert.deepEqual([r.status, r.result, r.decision], [pair[0], ...pair]);
    assert.equal(r.retryPolicy.mode, "CONDITIONAL");
    assert.deepEqual(c.appendedMetrics.find(m => m.metric === "retry_policy").value, r.retryPolicy);
    if (prior.experimentId === noteId) {
      assert.deepEqual(r.period, c.period);
      assert.deepEqual([r.evidence.ga4.note.sessions, r.evidence.ga4.x.sessions], [1, 1]);
      assert.equal(prior.successThreshold.channelSessionsMin, 20);
      assert.equal(r.evidence.trafficSufficiency.value, "FAILED");
      assert.deepEqual(r.evidence.ga4.affiliateClick, { value: null, status: "NO_ROWS_RETURNED" });
      assert.equal(r.evidence.ga4.postPeriodIncluded, false);
      assert.equal(r.evidence.rakuten.revenue, 0); assert.equal(r.evidence.rakuten.commissionField, "rewards");
      assert.equal(r.attributedPerformance.revenue, null);
      assert.deepEqual(r.retryPolicy.conditions.map(c => c.conditionId).sort(), [
        "new-acquisition-method-defined", "traffic-evidence-20-per-channel-in-14-days",
        "target-lp-affiliate-click-verified", "rakuten-snapshot-retrievable",
      ].sort());
    } else {
      const p = r.evidence.primary, post = r.evidence.postPeriod;
      assert.deepEqual(p.period, c.period); assert.equal(post.includedInPrimary, false);
      assert.equal(p.successThreshold, prior.successThreshold.impressionsCumulative);
      assert.equal(p.falsificationThreshold, prior.killThreshold.impressionsCumulativeAtReviewDate);
      assert.equal(p.gscClicks.value, null); assert.equal(r.evidence.ga4.sessions, null);
      assert.equal(r.evidence.affiliateClickMeasurementStatus, "NOT_VERIFIED");
      assert.equal(r.falsification.marketDemandVerdict, null);
      const senior = prior.experimentId.endsWith("senior-cat-food");
      assert.equal(p.gscImpressions.value, senior ? 6 : 0);
      assert.equal(post.additionalImpressions, senior ? 3 : 0);
      assert.equal(r.falsification.status, senior ? "INCONCLUSIVE" : "FALSIFIED");
    }
    projected.items[i] = next;
  }
  assert.deepEqual(projected, after);
  assert.equal(after.items.filter(e => e.status === "RUNNING").length, 0);
  assert.deepEqual(bundle.monetizationConcurrency, { group: "AFFILIATE_MONETIZATION", running: 0, limit: 1,
    source: "Current registry after explicit authorized closure; no new start", reservationCreated: false });
}
