import test from "node:test";
import assert from "node:assert/strict";
import { validateContext, validateManifest, OPERATIONS, POLICY, statusFor } from "../../acquisition-planner/model.js";
import { channelProfile } from "../../acquisition-planner/channels.js";
import { setup, fixture } from "./acquisition-planner-helpers.js";

test("Planner permissions are seven false flags, max one plan and no implicit reselection", async () => {
  const cases = await fixture("cases"); assert.deepEqual(Object.keys(OPERATIONS), cases.falseFlags); assert(Object.values(OPERATIONS).every((v) => v === false));
  assert.equal(POLICY.maxPlans, 1); assert.equal(POLICY.implicitReselection, false);
});
test("Planner keeps all three statuses and blocker precedence", () => {
  assert.equal(statusFor([]), "READY"); assert.equal(statusFor([{ status: "MANUAL_REVIEW_REQUIRED" }]), "MANUAL_REVIEW_REQUIRED");
  assert.equal(statusFor([{ status: "MANUAL_REVIEW_REQUIRED" }, { status: "BLOCKED" }]), "BLOCKED");
});
test("Manifest pins Selector hash and rejects missing input or native purpose", () => {
  assert.throws(() => validateManifest({ schemaVersion: 1, purpose: "NOTE_NATIVE_MONETIZATION", isSynthetic: false, inputs: {} }));
  assert.throws(() => validateManifest({ schemaVersion: 1, purpose: "AFFILIATE_MONETIZATION", isSynthetic: false, inputs: { selectorReport: { path: "untrusted.json" } } }));
});
test("Context version/hash and explicit freshness policies are mandatory", async () => {
  const b = await setup(), c = b.planningContext; validateContext(c, b.isSynthetic);
  c.policy.maxSelectorAgeDays = null; assert.throws(() => validateContext(c, b.isSynthetic)); c.policy.maxSelectorAgeDays = 2;
  c.policy.policyHash = "0".repeat(64); assert.throws(() => validateContext(c, b.isSynthetic));
});
test("Native context and synthetic mismatch fail closed", async () => {
  const b = await setup(); assert.throws(() => validateContext(b.planningContext, true)); b.planningContext.purpose = "NOTE_NATIVE_MONETIZATION";
  assert.throws(() => validateContext(b.planningContext, b.isSynthetic));
});
test("Action fields and forged measurement states are not input capabilities", async () => {
  const b = await setup(); b.planningContext.canPost = true; assert.throws(() => validateContext(b.planningContext, b.isSynthetic));
  delete b.planningContext.canPost; b.planningContext.measurementId.status = "VERIFIED_EXISTING"; assert.throws(() => validateContext(b.planningContext, b.isSynthetic));
});
test("Provider policy cannot invent an ASP host or omit explicit parameter evidence", async () => {
  const b = await setup(), c = b.planningContext; c.policy.providerPolicy.allowedHostnames = ["example.test"]; assert.throws(() => validateContext(c, b.isSynthetic));
  c.policy.providerPolicy.allowedHostnames = ["hb.afl.rakuten.co.jp"]; delete c.policy.providerPolicy.measurementParameter; assert.throws(() => validateContext(c, b.isSynthetic));
});
test("Channel extensions are declarative, reject override and native note purpose", () => {
  assert.equal(channelProfile("unknown"), null);
  const p = { ...channelProfile("x"), channel: "manual_referral", source: "manual_referral" }; assert.equal(channelProfile(p.channel, [p]).channel, p.channel);
  assert.throws(() => channelProfile("note", [{ ...p, channel: "note" }])); assert.throws(() => channelProfile(p.channel, [{ ...p, purpose: "NOTE_NATIVE_MONETIZATION" }]));
});
test("Checklist confirmations are scoped, attributed and not executable completion flags", async () => {
  const b = await setup(); b.planningContext.checklistConfirmations[0].status = "PUBLISHED"; assert.throws(() => validateContext(b.planningContext, b.isSynthetic));
});
