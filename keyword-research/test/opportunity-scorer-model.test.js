import test from "node:test";
import assert from "node:assert/strict";
import { validateInputs, hash } from "../../opportunity-scorer/model.js";
import { POLICY, MAX_SCORES } from "../../opportunity-scorer/policy.js";
import { data, run, COMPONENT_KEYS } from "./opportunity-scorer-helpers.js";

test("actual Scanner-generated synthetic fixture and fixed policy satisfy the contracts", async () => {
  const d = await data();
  validateInputs(d.scanner, d.context);
  assert.deepEqual(MAX_SCORES, { purchaseIntent: 35, offerFit: 30, lpReuse: 20, demand: 15 });
  assert.equal(Object.values(MAX_SCORES).reduce((a, b) => a + b), 100);
  assert.equal(POLICY.evidenceType, "HYPOTHESIS");
  for (const a of run(d).assessments) for (const c of Object.values(a.components)) for (const key of COMPONENT_KEYS) assert(Object.hasOwn(c, key), key);
});

test("versions, collections, duplicate IDs, evidence references and hashes fail closed", async () => {
  const changes = [
    (d) => { d.scanner.schemaVersion = 2; }, (d) => { d.scanner.outputType = "OTHER"; },
    (d) => { d.scanner.candidates.push(structuredClone(d.scanner.candidates[0])); },
    (d) => { d.scanner.evidence.push(structuredClone(d.scanner.evidence[0])); },
    (d) => { d.scanner.candidates[0].evidenceRefs.push("missing"); },
    (d) => { d.scanner.evidence[0].sourceFileHash = "0".repeat(64); },
    (d) => { d.context.scannerRunId = "other"; },
    (d) => { d.context.scannerFileHash = "0".repeat(64); },
    (d) => { d.context.policyVersion = "legacy-policy"; },
    (d) => { d.context.policyHash = "0".repeat(64); },
  ];
  for (const change of changes) { const d = await data(); change(d); assert.throws(() => run(d)); }
});

test("weighted numeric values accept 30/35 and reject coercion, out-of-range and invalid maxScore", async () => {
  for (const value of [-1, 36, NaN, Infinity, "30", true]) {
    const d = await data(); d.context.assessments[0].components.purchaseIntent.value = value;
    assert.throws(() => run(d));
  }
  const d = await data(); d.context.assessments[0].components.purchaseIntent.maxScore = 100;
  assert.throws(() => run(d), /maxScore/);
});

test("native purpose, foreign LP/offer/region, synthetic downgrade and bad assessment periods fail", async () => {
  for (const change of [
    (d) => { d.context.purpose = "NOTE_NATIVE_MONETIZATION"; },
    (d) => { d.context.assessments[0].purpose = "NOTE_NATIVE_MONETIZATION"; },
    (d) => { d.context.assessments[0].targetLP = "https://example.test/other"; },
    (d) => { d.context.assessments[0].itemCodes = ["new-asp:1"]; },
    (d) => { d.context.assessments[0].country = "US"; },
    (d) => { d.context.assessments[0].isSynthetic = false; },
    (d) => { d.scanner.evidence[0].isSynthetic = false; },
    (d) => { d.context.assessments[0].applicablePeriod.start = "2026-02-30"; },
  ]) { const d = await data(); change(d); assert.throws(() => run(d)); }
});

test("financial evidence and another candidate's JSON pointer cannot supply exploration points", async () => {
  const d = await data();
  d.context.assessments[0].components.purchaseIntent.inputRefs = ["/candidates/1/intent"];
  assert.throws(() => run(d), /same candidate/);
  const e = await data();
  e.context.assessments[0].components.purchaseIntent = { value: 30, maxScore: 35, evidenceType: "HYPOTHESIS", reason: "forbidden", evidenceRefs: e.scanner.candidates[0].observedRevenueEvidence.revenue.evidenceRefs };
  assert.throws(() => run(e), /financial/);
});

test("points are never FACT, known points require rationale, source time and raw classifications survive", async () => {
  const d = await data(); d.context.assessments[0].components.purchaseIntent.evidenceType = "FACT";
  assert.throws(() => run(d), /hypotheses/);
  const e = await data(); delete e.context.assessments[0].components.purchaseIntent.reason;
  assert.throws(() => run(e), /rationale/);
  const f = await data(), before = hash(f);
  const result = run(f);
  assert.equal(hash(f), before);
  const c = result.assessments[0].components.demand;
  assert.equal(c.source[0].evidenceType, "ESTIMATE");
  assert.equal(c.source[0].retrievedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(c.period.evidencePeriods[0].start, "2026-09-01");
});
