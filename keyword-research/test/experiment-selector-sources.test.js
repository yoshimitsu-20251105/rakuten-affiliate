import test from "node:test";
import assert from "node:assert/strict";
import { readInputs, parseJson } from "../../experiment-selector/sources.js";
import { hash } from "../../experiment-selector/model.js";
import { setup, run, refresh, temporary, writeInputs } from "./experiment-selector-helpers.js";

test("Selector accepts BOM JSON and exact six-file byte provenance", async (t) => {
  const temp = await temporary(t), b = await setup(), path = await writeInputs(temp, b);
  assert.deepEqual(parseJson(Buffer.from('\uFEFF{"n":null}')), { n: null }); const input = await readInputs(path, b.asOf);
  assert.deepEqual(input.hashes, b.hashes); assert.equal(run(input).recommendationCount, 0);
});
test("Source expected byte hash mismatch fails without exposing file details", async (t) => {
  const temp = await temporary(t), b = await setup(), path = await writeInputs(temp, b);
  await temp.write("scannerReport.json", { privateSecret: "DO_NOT_EXPOSE" });
  await assert.rejects(readInputs(path, b.asOf), (e) => !e.message.includes("DO_NOT_EXPOSE") && e.message.includes("validation failed"));
});
test("Scorer must refer to this exact Scanner run and hash", async () => {
  const b = await setup(); b.scorerReport.scannerFileHash = "0".repeat(64); assert.throws(() => run(b), /source mismatch/);
});
test("Saved financial numbers cannot differ from Funnel provenance", async () => {
  const b = await setup(); b.scorerReport.observedPerformance[0].metrics.revenue.value = 999999; assert.throws(() => run(b), /Funnel provenance/);
});
test("Saved exploration total cannot fill an unknown component with zero", async () => {
  const b = await setup({ complete: false }); const a = b.scorerReport.assessments.find((a) => a.exploration.totalScore === null);
  a.exploration.totalScore = 62; assert.throws(() => run(b), /partial exploration total/);
});
test("Saved comparison groups cannot be fabricated", async () => {
  const b = await setup(); b.scorerReport.assessments[0].comparisonGroup = "0".repeat(64); assert.throws(() => run(b), /comparison changed/);
});
test("Learning ledger hash and supplied view must match", async () => {
  const b = await setup(); refresh(b); b.learningReport.ledgerHash = hash("wrong");
  const { validateInputsBundle } = await import("../../experiment-selector/sources.js"); assert.throws(() => validateInputsBundle(b, b.hashes, b), /ledger\/report mismatch/);
});
test("Current registry must be exactly represented in Learning source provenance", async () => {
  const b = await setup(); b.experimentsSnapshot.items.push({ experimentId: "unknown", status: "RUNNING", targetUrls: [] }); assert.throws(() => run(b), /missing from Learning provenance/);
});
test("Future source snapshots fail rather than leak future knowledge", async () => {
  const b = await setup(); b.scorerReport.generatedAt = "2027-01-01T00:00:00Z"; assert.throws(() => run(b), /after Selector asOf/);
});
test("A default context cannot be relabelled as a real LP/channel experiment", async () => {
  const b = await setup(); b.selectionContext.proposals[0].channel = "x"; b.selectionContext.proposals[0].scope.channel = "x";
  assert.throws(() => run(b), /actual Scorer context/);
});
test("Unknown LP, offer or history reference is rejected", async () => {
  const b = await setup(); b.selectionContext.proposals[0].itemCodes = ["invented:item"]; assert.throws(() => run(b), /LP\/offer/);
});
