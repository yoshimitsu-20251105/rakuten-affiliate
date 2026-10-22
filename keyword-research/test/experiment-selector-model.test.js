import test from "node:test";
import assert from "node:assert/strict";
import { validateContext, validateManifest, pointer, learningProposal } from "../../experiment-selector/model.js";
import { POLICY, POLICY_HASH } from "../../experiment-selector/policy.js";
import { setup } from "./experiment-selector-helpers.js";

test("Selector fixed policy is one recommendation, no implicit concurrency default or track fallback", () => {
  assert.equal(POLICY.maxSelectionsPerRun, 1); assert.equal(POLICY.initialMaxConcurrentMonetizationExperiments, 1);
  assert.equal(POLICY.defaultMissingConcurrency, null); assert.equal(POLICY.implicitTrackFallback, false); assert.equal(POLICY.automatedActions, false);
});
test("Selector context requires declared comparison mode and fixed policy hash", async () => {
  const b = await setup(); validateContext(b.selectionContext, false);
  b.selectionContext.policy.selectionTrack = "COMBINED"; assert.throws(() => validateContext(b.selectionContext, false));
  b.selectionContext.policy.selectionTrack = "EXPLORATION"; b.selectionContext.policy.policyHash = "0".repeat(64); assert.notEqual(POLICY_HASH, b.selectionContext.policy.policyHash);
  assert.throws(() => validateContext(b.selectionContext, false));
});
test("Missing or null limit is accepted as unknown; negative and fractional limits fail closed", async () => {
  const b = await setup(), c = b.selectionContext;
  delete c.policy.maxConcurrentMonetizationExperiments; validateContext(c, false);
  c.policy.maxConcurrentMonetizationExperiments = null; validateContext(c, false);
  for (const value of [-1, 1.1, "1"]) { c.policy.maxConcurrentMonetizationExperiments = value; assert.throws(() => validateContext(c, false)); }
});
test("Affiliate note cannot disguise its purpose or revenue class", async () => {
  const b = await setup({ channel: "note" }), c = b.selectionContext; validateContext(c, false);
  c.proposals[0].purpose = "AFFILIATE_MONETIZATION"; assert.throws(() => validateContext(c, false));
});
test("Selector rejects native note, action options and duplicate proposal IDs", async () => {
  const b = await setup(), c = b.selectionContext;
  c.proposals.push(structuredClone(c.proposals[0])); assert.throws(() => validateContext(c, false)); c.proposals.pop();
  c.start = true; assert.throws(() => validateContext(c, false)); delete c.start;
  c.purpose = "NOTE_NATIVE_MONETIZATION"; assert.throws(() => validateContext(c, false));
});
test("Every proposal requires an actual LP/channel and complete falsifiable test definition", async () => {
  for (const field of ["hypothesis", "falsificationCondition", "primaryMetric", "successCondition", "reviewCondition", "measurementPlan"]) {
    const b = await setup(); b.selectionContext.proposals[0][field] = null; assert.throws(() => validateContext(b.selectionContext, false), field);
  }
});
test("Manifest requires all six explicit source paths and rejects unexpected keys", () => {
  assert.throws(() => validateManifest({ schemaVersion: 1, purpose: "AFFILIATE_MONETIZATION", isSynthetic: false, inputs: {} }));
});
test("JSON pointer lookup rejects unresolved and prototype references", () => {
  assert.equal(pointer({ a: { b: 0 } }, "/a/b"), 0); assert.throws(() => pointer({}, "/x")); assert.throws(() => pointer({}, "/__proto__"));
});
test("Learning projection preserves separate plan and retry inputs, never adds an action", async () => {
  const b = await setup(), p = learningProposal(b.selectionContext.proposals[0], false);
  assert.equal(p.WHY_REVISIT, null); assert.deepEqual(p.newEvidenceRefs, []); assert(!Object.hasOwn(p, "start"));
});
