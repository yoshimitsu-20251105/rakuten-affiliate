import test from "node:test";
import assert from "node:assert/strict";
import { readInputs } from "../../acquisition-planner/sources.js";
import { setup, run, temporary, writeInputs, AS_OF, refresh, addOrder } from "./acquisition-planner-helpers.js";

test("Six original hashes and exact historical Selector report reproduce through file boundary", async (t) => {
  const b = await setup({ channel: "note" }), temp = await temporary(t), path = await writeInputs(temp, b), loaded = await readInputs(path, AS_OF);
  assert.equal(run(loaded).planStatus, "READY"); assert.equal(loaded.hashes.selectorReport, b.hashes.selectorReport);
});
test("Tampered Selector raw file is refused against pinned source hash without disclosure", async (t) => {
  const b = await setup(), temp = await temporary(t), path = await writeInputs(temp, b);
  await temp.write("selectorReport.json", { secret: "DO_NOT_PRINT" });
  await assert.rejects(readInputs(path, AS_OF), (e) => !e.message.includes("DO_NOT_PRINT") && e.message.includes("validation failed"));
});
test("Original source hash mismatch and modified saved decision are refused", async () => {
  const b = await setup(); b.selectorReport.inputHashes.scannerReport = "0".repeat(64); assert.throws(() => run(b), /source hash/);
  const other = await setup(); other.selectorReport.selectionReason = "forged"; assert.throws(() => run(other), /does not reproduce/);
});
test("Multiple recommendations or mismatched candidate cannot become Planner choices", async () => {
  const b = await setup(); b.selectorReport.recommendations.push(structuredClone(b.selectorReport.recommendations[0])); assert.throws(() => run(b), /cardinality/);
  const c = await setup(); c.selectorReport.recommendations[0].candidateId = "different"; c.selectorReport.selectedProposal.candidateId = "different"; assert.throws(() => run(c));
});
test("Future Selector knowledge is not used at an earlier Planner asOf", async () => {
  const b = await setup(); b.asOf = "2026-10-20T00:00:00Z"; assert.throws(() => run(b), /after Planner/);
});
test("Missing original HTML cannot be replaced with present HTML to claim historical verification", async () => {
  const b = await setup({ channel: "note" }); b.original.measurementContexts = {};
  const r = run(b); assert.equal(r.planStatus, "MANUAL_REVIEW_REQUIRED"); assert(r.blockingReasons.some((r) => r.code === "ORIGINAL_VERIFICATION_SNAPSHOT_MISSING"));
});
test("Current ledger without imported changed registry never produces READY", async () => {
  const b = await setup(); b.current.experimentsSnapshot.items.push({ experimentId: "new-active", status: "RUNNING", targetUrls: [] });
  const r = run(b); assert.notEqual(r.planStatus, "READY"); assert(r.blockingReasons.some((r) => r.code === "CURRENT_REGISTRY_LEARNING_IMPORT_MISSING"));
});
test("Current context cannot replace the selected candidate, scope or measurement property", async () => {
  const b = await setup(); b.current.selectionContext.proposals[0].variables.contentPattern = "ranking";
  assert(run(b).blockingReasons.some((r) => r.code === "SELECTED_SCOPE_MISMATCH"));
  const n = await setup({ channel: "note" }); n.current.selectionContext.proposals[0].measurement.ga4PropertyReference = "different-property";
  const r = run(n); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "MEASUREMENT_PROPERTY_CHANGED"));
});
test("Deleting original immutable Learning records requires review instead of hiding history", async () => {
  const b = await setup({ channel: "note" }); const { emptyLedger } = await import("../../learning-engine/model.js"); b.current.learningLedger = emptyLedger();
  const r = run(b); assert.notEqual(r.planStatus, "READY"); assert(r.blockingReasons.some((r) => r.code === "LEARNING_HISTORY_NOT_APPEND_ONLY"));
});
test("Original recommendation0 is a normal BLOCKED result with no synthetic plan", async (t) => {
  const b = await setup({ noRecommendation: true }), temp = await temporary(t), loaded = await readInputs(await writeInputs(temp, b), AS_OF), r = run(loaded);
  assert.deepEqual(r.plans, []); assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.blockingReasons[0].code, "NO_SELECTOR_RECOMMENDATION");
});
test("Raw CSV evidence hash cannot be changed after its explicit source declaration", async () => {
  const b = await setup(); addOrder(b); b.orderEvidence.csv = Buffer.from("modified CSV"); assert.throws(() => run(b), /CSV byte hash/);
});
test("Future CSV retrieval cannot establish current attribution FACT", async () => {
  const b = await setup(); addOrder(b); b.orderEvidence.metadata.retrievedAt = "2026-10-23T00:00:00Z"; assert.throws(() => run(b), /Future order evidence/);
});
