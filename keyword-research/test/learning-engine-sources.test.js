import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { emptyLedger, hash } from "../../learning-engine/model.js";
import { readManifestSources, buildImport } from "../../learning-engine/sources.js";
import { append } from "../../learning-engine/store.js";
import { buildReport } from "../../learning-engine/report.js";
import { performanceForExperiment } from "../../learning-engine/learning.js";
import { evaluateCondition } from "../../learning-engine/retry.js";
import { data as scorerData, run as scorerRun } from "./opportunity-scorer-helpers.js";
import { base, input, spec, experiment, funnel, temporary, AS_OF, IMPORTED_AT, targetLP } from "./learning-engine-helpers.js";

test("actual repository 6 experiments and 2 decisions import without mutation", async () => {
  const read = async (name) => JSON.parse(await readFile(new URL(`../../strategy/${name}.json`, import.meta.url), "utf8"));
  const exps = await read("experiments"), decisions = await read("decisions"), before = hash([exps, decisions]);
  const i = input([[spec("experiments", { isSynthetic: false }), exps], [spec("decisions", { isSynthetic: false }), decisions]]);
  const ledger = append(emptyLedger(), i.additions).ledger;
  assert.equal(hash([exps, decisions]), before); assert.equal(ledger.experimentSnapshots.length, 6);
  assert.equal(ledger.experimentSnapshots.filter((e) => e.status === "RUNNING").length, 4);
  const failed = ledger.experimentSnapshots.find((e) => e.experimentId === "exp-2026-09-10-grain-free-cat-food");
  assert.equal(failed.result, "FAILED"); assert.equal(failed.decision, "IMPROVE"); assert.equal(ledger.learnings.length, 0);
  assert.equal(ledger.decisions.filter((d) => d.type === "LEGACY_OTHER" && d.decision === null).length, 2);
  const note = ledger.experimentSnapshots.find((e) => e.experimentId.includes("note-vs-x"));
  assert.equal(note.scope.channel, null); assert.equal(note.raw.result, null); assert.equal(note.raw.metrics[1].value.includes("NOT_AVAILABLE"), true);
  const r = buildReport(ledger, { asOf: AS_OF, generatedAt: AS_OF });
  assert(r.experimentReviews.every((e) => e.observedPerformance.metrics.revenue.value === null));
});
test("legacy FACT prefix remains source-declared text, values 0/1 remain observations", () => {
  const b = base(); const s = b.ledger.experimentSnapshots[0];
  assert.equal(s.sourceDeclaredLearnings[0].sourceDeclaredEvidenceType, "FACT"); assert.equal(b.ledger.learnings.length, 0);
  assert.equal(b.ledger.evidence[0].value, 0); assert.equal(b.ledger.evidence[0].observedAt, "2026-10-10");
  assert.equal(b.ledger.evidence[0].period, null); assert.match(b.ledger.evidence[0].validationStatus, /NOT_CURRENT_VERIFICATION/);
});
test("missing optional sources differ from valid empty experiments", () => {
  const i = input([[spec("experiments"), { items: [] }]]), ledger = append(emptyLedger(), i.additions).ledger;
  const r = buildReport(ledger, { asOf: AS_OF, generatedAt: AS_OF, isSynthetic: true });
  assert.equal(r.sourceStates.find((s) => s.sourceType === "experiments").state, "EMPTY");
  assert.equal(r.sourceStates.find((s) => s.sourceType === "funnel_report").state, "NOT_PROVIDED");
});
test("Funnel rewards / amount, approval states, partial conversions and EPC stay distinct", () => {
  const report = funnel(), b = base({ extra: [[spec("funnel_report"), report]] });
  const raw = b.ledger.evidence.find((e) => e.metricOrClaim === "funnel_report").value;
  assert.equal(raw.metrics.revenue.value, 300); assert.equal(raw.metrics.approvedRevenue.value, 200);
  assert.equal(raw.metrics.cancelledRevenue.value, 50); assert.equal(raw.metrics.merchandiseSales.value, 35000);
  assert.equal(raw.byMeasurementId[0].metrics.conversions.value, null); assert.equal(raw.metrics.epc.value, null);
});
test("official progressing-month 0 is account snapshot, never experiment 0", () => {
  const r = funnel({ zero: true, nonSyntheticSchemaBranch: true });
  const b = base({ nonSyntheticSchemaBranch: true, extra: [[spec("funnel_report", { isSynthetic: false }), r]] });
  const report = buildReport(b.ledger, { asOf: AS_OF, generatedAt: AS_OF });
  assert.equal(report.accountContext[0].report.metrics.revenue.value, 0);
  assert.equal(report.accountContext[0].report.sourceBatch.recordCount, 0);
  assert.equal(report.accountContext[0].report.metrics.revenue.final, false);
  assert.equal(report.experimentReviews[0].observedPerformance.metrics.revenue.value, null);
});
test("Funnel MetricObservation preserves coverage and supports a scoped observation window without finalizing the month", () => {
  const r = funnel({ zero: true, nonSyntheticSchemaBranch: true });
  const b = base({ nonSyntheticSchemaBranch: true, extra: [[spec("funnel_report", { isSynthetic: false }), r]] });
  const e = b.ledger.evidence.find((e) => e.metricOrClaim === "revenue" && e.scope.accountScopeId);
  assert.equal(e.value, 0); assert.equal(e.final, false); assert.equal(e.sourceObservation.value, 0);
  const c = { conditionId: "account-window", type: "OBSERVATION_WINDOW", predicate: "COMPLETE_THROUGH", required: true,
    expectedValue: { endDate: "2026-10-20", periodStart: "2026-10-01", final: false }, scope: { accountScopeId: "synthetic-account" }, evidenceRefs: [], reason: "Only account coverage through snapshot" };
  const p = { isSynthetic: false, newEvidenceRefs: [e.recordId] };
  assert.equal(evaluateCondition(c, p, b.ledger, { asOf: AS_OF }).status, "SATISFIED");
  c.expectedValue.final = true; assert.equal(evaluateCondition(c, p, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
  c.scope = { experimentIds: ["synthetic-exp"] }; assert.equal(evaluateCondition(c, p, b.ledger, { asOf: AS_OF }).status, "UNKNOWN");
});
function bound({ duplicate = false, noBinding = false } = {}) {
  const ex = experiment({ metrics: [{ metric: "measurement_id", value: "synthetic-note", sourceType: "user_verified", source: "Synthetic explicit ID binding", observedAt: "2026-09-30" }] });
  const report = funnel({ nonSyntheticSchemaBranch: true });
  const entries = [[spec("experiments", { isSynthetic: false }), { items: duplicate ? [ex, { ...ex, experimentId: "other-exp" }] : [ex] }],
    [spec("funnel_report", { isSynthetic: false }), report]];
  const first = input(entries), id = first.additions.evidence.find((e) => e.metricOrClaim === "measurement_id").recordId;
  const link = { sourceId: "funnel_report", experimentId: "synthetic-exp", measurementId: "synthetic-note", accountScopeId: "synthetic-account",
    period: { start: "2026-10-01", end: "2026-10-31" }, targetLP, channel: "organic_search", evidenceRefs: noBinding ? [] : [id], mappingEvidenceReference: "synthetic mapping proof" };
  const i = input(entries, { links: duplicate ? [link, { ...link, experimentId: "other-exp" }] : [link] });
  return { ...i, entries, link, ledger: append(emptyLedger(), i.additions).ledger };
}
test("only real-schema record ID plus explicit unique scoped binding permits financial FACT", () => {
  const b = bound(), p = performanceForExperiment(b.ledger, "synthetic-exp", AS_OF);
  assert.equal(p.metrics.revenue.value, 300); assert.equal(p.metrics.approvedRevenue.value, 200);
  assert.equal(p.metrics.conversions.value, null); assert.equal(p.metrics.epc.value, null);
  assert.equal(performanceForExperiment(bound({ noBinding: true }).ledger, "synthetic-exp", AS_OF).metrics.revenue.value, null);
  assert.equal(performanceForExperiment(bound({ duplicate: true }).ledger, "synthetic-exp", AS_OF).metrics.revenue.missingReason, "SHARED_MEASUREMENT_ID");
});
test("later financial snapshots replace selection, never add earnings; same-asOf conflicts remain null", () => {
  const b = bound(), r = structuredClone(b.entries[1][1]);
  r.sourceBatch.snapshotAsOf = "2026-10-21T00:00:00Z"; r.sourceBatch.retrievedAt = "2026-10-21T00:01:00Z";
  for (const m of Object.values(r.byMeasurementId[0].metrics)) if (m && typeof m === "object") { m.snapshotAsOf = r.sourceBatch.snapshotAsOf; m.retrievedAt = r.sourceBatch.retrievedAt; }
  r.byMeasurementId[0].metrics.revenue.value = 400;
  const s = spec("funnel_report", { sourceId: "later", isSynthetic: false });
  const i = input([b.entries[0], [s, r]], { links: [{ ...b.link, sourceId: "later" }] });
  const ledger = append(b.ledger, i.additions).ledger;
  assert.equal(performanceForExperiment(ledger, "synthetic-exp", AS_OF).metrics.revenue.value, 400);
  const conflict = structuredClone(r); conflict.byMeasurementId[0].metrics.revenue.value = 500;
  const next = input([b.entries[0], [spec("funnel_report", { sourceId: "conflict", isSynthetic: false }), conflict]], { links: [{ ...b.link, sourceId: "conflict" }] });
  const bad = append(ledger, next.additions).ledger;
  assert.equal(performanceForExperiment(bad, "synthetic-exp", AS_OF).metrics.revenue.missingReason, "CONFLICT");
});
test("saved Scorer retains independent comparisons and null partial score", async () => {
  const d = await scorerData(), scored = scorerRun(d);
  const i = base({ extra: [[spec("scanner_report"), d.scanner], [spec("scorer_report"), scored]] });
  const r = buildReport(i.ledger, { asOf: AS_OF, generatedAt: AS_OF, isSynthetic: true });
  assert.deepEqual(r.scorerContext[0].report.observedPerformance, scored.observedPerformance);
  assert.deepEqual(r.scorerContext[0].report.assessments, scored.assessments);
  assert(scored.assessments.some((a) => a.exploration.totalScore === null));
});
test("synthetic origin cannot be relabelled by a real source wrapper", () => {
  assert.throws(() => base({ nonSyntheticSchemaBranch: true, extra: [[spec("funnel_report", { isSynthetic: false }), funnel()]] }));
});
test("explicit missing file, bad hash, invalid JSON and malformed contract fail closed", async (t) => {
  const temp = await temporary(t), m = base().manifest;
  m.sources[0].path = "absent.json"; await assert.rejects(readManifestSources(m, temp.root));
  m.sources[0].path = await temp.write("bad.json", "{invalid"); await assert.rejects(readManifestSources(m, temp.root));
  m.sources[0].path = await temp.write("ok.json", { items: [] }); m.sources[0].expectedSha256 = "0".repeat(64);
  await assert.rejects(readManifestSources(m, temp.root));
  assert.throws(() => input([[spec("experiments"), { items: [experiment({ status: "KILL" })] }]]));
});
test("future source retrieval is not made visible by importing now", () => {
  const i = input([[spec("experiments", { retrievedAt: "2026-10-23T00:00:00Z" }), { items: [experiment()] }]]);
  const ledger = append(emptyLedger(), i.additions).ledger;
  assert.equal(buildReport(ledger, { asOf: AS_OF, generatedAt: AS_OF, isSynthetic: true }).experimentReviews.length, 0);
  assert.equal(buildReport(ledger, { asOf: "2026-10-21T00:00:00Z", generatedAt: AS_OF, isSynthetic: true }).experimentReviews.length, 0);
});
