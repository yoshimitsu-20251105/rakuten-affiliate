import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyRegistry, concurrency, assessRetry } from "../../experiment-selector/gates.js";
import { GROUP } from "../../experiment-selector/policy.js";
import { setup, run, active, classify, fixture, AS_OF, refresh } from "./experiment-selector-helpers.js";
import { base, readFixture, verified, pageHash, spec, input as learningInput } from "./learning-engine-helpers.js";
import { emptyLedger } from "../../learning-engine/model.js";
import { append } from "../../learning-engine/store.js";

for (const row of (await fixture("cases")).concurrency) test(`Concurrency counts only declared same group: ${row.class}/${row.group}`, async () => {
  const e = active(), b = await setup({ registry: [e] });
  if (row.group && !b.selectionContext.policy.monetizationGroups.includes(row.group)) b.selectionContext.policy.monetizationGroups.push(row.group);
  if (row.class !== "UNKNOWN") classify(b, e, row.class, row.group);
  const r = concurrency(b, GROUP); assert.equal(r.status, row.expected);
  if (row.expected === "UNKNOWN") assert.equal(r.runningCount, null);
});
test("Real registered RUNNING four classify as three exposure tests and one revenue acquisition test", async () => {
  const registry = JSON.parse(await readFile(new URL("../../strategy/experiments.json", import.meta.url), "utf8"));
  const b = await setup(); b.experimentsSnapshot = registry; const rows = classifyRegistry(b).filter((r) => r.status === "RUNNING");
  assert.equal(rows.length, 4); assert.equal(rows.filter((r) => r.experimentClass === "SEO_DISCOVERY").length, 3);
  assert.equal(rows.filter((r) => r.monetizationGroup === GROUP).length, 1);
  assert.equal(concurrency(b, GROUP).status, "DEFERRED");
  assert.equal(concurrency(b, GROUP).runningCount, 1);
});
test("Legacy declared objective mutation invalidates the pinned classification", async () => {
  const registry = JSON.parse(await readFile(new URL("../../strategy/experiments.json", import.meta.url), "utf8"));
  const b = await setup(); b.experimentsSnapshot = registry; registry.items.find((e) => e.status === "RUNNING").successThreshold = { revenue: 1 };
  assert.equal(concurrency(b, GROUP).status, "UNKNOWN");
});
test("Title, monetizationSource and absent revenue do not classify an unknown objective", async () => {
  const e = active({ title: "SEO measurement revenue", monetizationSource: "rakuten" }), b = await setup({ registry: [e] });
  assert.equal(classifyRegistry(b)[0].experimentClass, "UNKNOWN"); assert.equal(run(b).recommendationCount, 0);
});
test("Missing, null and zero concurrency limits all produce zero recommendations", async () => {
  for (const limit of [undefined, null, 0]) {
    const b = await setup(); b.selectionContext.proposals.pop(); b.selectionContext.policy.maxConcurrentMonetizationExperiments = limit;
    const r = run(b); assert.equal(r.recommendationCount, 0); assert.equal(r.concurrency[0].limit, limit ?? null);
  }
});
test("Unknown stopped experiment does not consume a running slot", async () => {
  const b = await setup({ registry: [active({ status: "STOPPED" })] }); assert.equal(concurrency(b, GROUP).status, "PASS");
});
test("Registry incomplete, stale or unconfirmed freshness fails closed", async () => {
  for (const change of [{ coverage: "UNKNOWN" }, { observedAt: "2026-10-01T00:00:00Z" }, { maxAgeDays: null }]) {
    const b = await setup(); Object.assign(b.selectionContext.registry, change); assert.equal(concurrency(b, GROUP).status, "UNKNOWN");
  }
});
test("Explicit classification must remain tied to the exact raw experiment", async () => {
  const e = active(), b = await setup({ registry: [e] }); classify(b, e, "SEO"); b.selectionContext.experimentClassifications[0].recordHash = "0".repeat(64);
  assert.equal(concurrency(b, GROUP).status, "UNKNOWN");
});
test("Nonrevenue concurrency exclusion does not authorize interference with the same running LP", async () => {
  const b = await setup(); const lp = b.selectionContext.proposals[0].targetLP;
  const e = active({ targetUrls: [lp] }), c = await setup({ registry: [e] }); classify(c, e, "SEO"); const r = run(c);
  assert.equal(r.concurrency[0].status, "PASS"); assert(r.proposals.find((p) => p.candidateId === b.selectionContext.proposals[0].candidateId).rejectionReason.includes("RUNNING_LP_OR_MEASUREMENT_INTERFERENCE"));
});
test("Retry three states and FAILED are independent from KILL", () => {
  const result = { kind: "EXPERIMENT_RESULT", status: "FAILED", match: "EXACT_SCOPE" };
  assert.equal(assessRetry({ matches: [result] }).status, "UNKNOWN");
  const learning = { kind: "LEARNING", match: "EXACT_SCOPE", retryStatus: "SATISFIED", revisionState: "ACTIVE", conditions: [{ required: true, status: "SATISFIED" }] };
  assert.equal(assessRetry({ matches: [result, learning] }).status, "SATISFIED");
  learning.conditions[0].status = "NOT_SATISFIED"; assert.equal(assessRetry({ matches: [result, learning] }).status, "NOT_SATISFIED");
  learning.conditions[0].status = "UNKNOWN"; learning.retryStatus = "UNKNOWN"; assert.equal(assessRetry({ matches: [result, learning] }).status, "UNKNOWN");
});
test("Unresolved KILL/HOLD, possible match and revision conflict cannot be released by a score", () => {
  for (const m of [{ kind: "RECORDED_DECISION", decision: "KILL", retryPolicy: { mode: "UNKNOWN" }, match: "EXACT_SCOPE" },
    { kind: "RECORDED_DECISION", decision: "HOLD", retryPolicy: { mode: "NO_RETRY_PROPOSED" }, match: "EXACT_SCOPE" },
    { kind: "EXPERIMENT_RESULT", match: "POSSIBLE_MATCH" }, { kind: "LEARNING", match: "EXACT_SCOPE", revisionState: "CONFLICT" }])
    assert.equal(assessRetry({ matches: [m] }).status, "UNKNOWN");
});
test("Real Learning retry evaluator lets documented FAILED retry pass without executing KILL/start", async () => {
  const b = await setup(), p = b.selectionContext.proposals[0];
  const history = base({ nonSyntheticSchemaBranch: true, experimentOverrides: { targetUrls: [p.targetLP], decision: null } });
  const review = await readFixture("review"); review.isSynthetic = false; review.decisions = [];
  review.learnings[0].scope.targetLP = p.targetLP; review.learnings[0].retryConditions[0].scope.targetLP = p.targetLP;
  const { buildReview } = await import("../../learning-engine/learning.js");
  history.ledger = append(history.ledger, buildReview(history.ledger, review, { recordedAt: AS_OF })).ledger;
  b.experimentsSnapshot.items = history.loaded[0].data.items;
  // New registry import retains old immutable Learning and fresh observation.
  const { buildImport } = await import("../../learning-engine/sources.js"); const { bindLedger } = await import("./experiment-selector-helpers.js");
  const { manifest, loaded } = bindLedger(b); b.learningLedger = append(history.ledger, buildImport(manifest, loaded, { recordedAt: AS_OF })).ledger;
  p.relatedExperimentIds = ["synthetic-exp"]; p.WHY_REVISIT = "SYNTHETIC new scoped demand"; p.whatChanged = "SYNTHETIC new evidence";
  p.newEvidenceRefs = [history.ledger.evidence.find((e) => e.observedAt === "2026-10-21").recordId];
  b.selectionContext.proposals = [p];
  const r = run(b); assert.equal(r.proposals[0].retryStatus, "SATISFIED"); assert.equal(r.recommendationCount, 1);
  assert.equal(r.canStartExperiment, false); assert.equal(b.experimentsSnapshot.items[0].status, "FAILED");
});
test("Affiliate note without current proof remains NOT_VERIFIED and cannot be recommended", async () => {
  const b = await setup({ channel: "note" }), r = run(b); assert.equal(r.recommendationCount, 0);
  assert(r.proposals.every((p) => p.measurementGateStatus === "NOT_VERIFIED" && p.rejectionReason.includes("AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET")));
});
test("Explicit NOT_IMPLEMENTED proof is retained and blocks Affiliate note even with complete score", async () => {
  const b = await setup({ channel: "note" }), p = b.selectionContext.proposals[0]; b.selectionContext.proposals = [p];
  const record = { targetLP: p.targetLP, affiliateClickMeasurementStatus: "NOT_IMPLEMENTED" };
  const added = learningInput([[spec("experiments", { isSynthetic: false }), b.experimentsSnapshot], [spec("measurement_records", { isSynthetic: false }), [record]]]);
  b.learningLedger = append(b.learningLedger, added.additions).ledger;
  p.measurement = { evidenceRef: b.learningLedger.evidence.find((e) => e.metricOrClaim === "lp_measurement").recordId, htmlPath: "proof.html", ga4PropertyReference: "synthetic-property" };
  b.measurementContexts[p.proposalId] = { currentPageHash: pageHash };
  const r = run(b); assert.equal(r.recommendationCount, 0); assert.equal(r.proposals[0].measurementGateStatus, "NOT_IMPLEMENTED");
});
test("PROPOSED or RETRACTED learning is not promoted to a binding retry condition", () => {
  for (const reviewStatus of ["PROPOSED", "RETRACTED"]) {
    const r = assessRetry({ matches: [{ kind: "LEARNING", match: "EXACT_SCOPE", revisionState: "ACTIVE", reviewStatus, retryStatus: "NOT_SATISFIED", conditions: [{ required: true, status: "NOT_SATISFIED" }] }] });
    assert.equal(r.required, false); assert.equal(r.status, "UNKNOWN");
  }
});
test("Affiliate note valid saved proof is VERIFIED; mismatched current HTML invalidates it", async () => {
  const b = await setup({ channel: "note" }), p = b.selectionContext.proposals[0]; b.selectionContext.proposals = [p];
  const record = verified({ targetLP: p.targetLP, evidence: { ...verified().evidence, targetLP: p.targetLP } });
  const added = learningInput([[spec("experiments", { isSynthetic: false }), b.experimentsSnapshot], [spec("measurement_records", { isSynthetic: false }), [record]]]);
  b.learningLedger = append(b.learningLedger, added.additions).ledger;
  const proof = b.learningLedger.evidence.find((e) => e.metricOrClaim === "lp_measurement");
  p.measurement = { evidenceRef: proof.recordId, htmlPath: "proof.html", ga4PropertyReference: record.ga4PropertyReference };
  b.measurementContexts[p.proposalId] = { currentPageHash: pageHash };
  const r = run(b); assert.equal(r.proposals[0].measurementGateStatus, "VERIFIED"); assert.equal(r.recommendationCount, 1); assert.equal(r.canStartExperiment, false);
  b.measurementContexts[p.proposalId].currentPageHash = "0".repeat(64); assert.equal(run(b).recommendationCount, 0);
});
test("Counter evidence must be explicitly acknowledged, not suppressed by score", async () => {
  const b = await setup({ mutate: (d) => { d.scanner.candidates[0].counterEvidence.push("SYNTHETIC contrary demand"); } });
  const p = b.selectionContext.proposals.find((p) => p.candidateId === b.scannerReport.candidates[0].candidateId);
  let r = run(b).proposals.find((r) => r.proposalId === p.proposalId); assert(r.rejectionReason.includes("COUNTER_EVIDENCE_REVIEW_REQUIRED"));
  p.historyReview = { counterEvidenceHashes: r.counterEvidence.map((x) => x.hash), reviewedBy: "synthetic-reviewer", reviewedAt: AS_OF, reason: "Reviewed contradiction; no claim of disproving it" };
  r = run(b).proposals.find((r) => r.proposalId === p.proposalId); assert(!r.rejectionReason.includes("COUNTER_EVIDENCE_REVIEW_REQUIRED"));
});
test("Scanner prior decision cannot silently disappear when absent from matched Learning history", async () => {
  const b = await setup({ mutate: (d) => { d.scanner.candidates[0].priorDecisions.push({ decisionId: "synthetic-unimported-decision", decision: "KILL", evidenceRefs: [] }); } });
  b.selectionContext.proposals = b.selectionContext.proposals.filter((p) => p.candidateId === b.scannerReport.candidates[0].candidateId);
  const r = run(b); assert.equal(r.recommendationCount, 0); assert(r.proposals[0].rejectionReason.includes("SCANNER_PRIOR_DECISION_REQUIRES_LINKED_HISTORY_REVIEW"));
});
test("An explicitly unavailable offer cannot be rescued by a high hypothesis score", async () => {
  const b = await setup({ mutate: (d) => { d.scanner.candidates[0].existingOffers[0].currentAvailability.value = false; } });
  b.selectionContext.proposals = b.selectionContext.proposals.filter((p) => p.candidateId === b.scannerReport.candidates[0].candidateId);
  const r = run(b); assert.equal(r.recommendationCount, 0); assert(r.proposals[0].rejectionReason.includes("DECLARED_LP_OR_OFFER_UNAVAILABLE"));
});
