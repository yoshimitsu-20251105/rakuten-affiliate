import test from "node:test";
import assert from "node:assert/strict";
import { validateMeasurementRecord, measurementAvailability, assertNewAffiliateNoteExperimentAllowed } from "../../funnel-measurement/measurement-status.js";
import { verified, targetLP, pageHash } from "./funnel-helpers.js";

const context = () => ({ targetLP, currentPageHash: pageHash, ga4PropertyReference: "synthetic-property", at: "2026-10-20T03:00:00Z" });
const start = () => ({ purpose: "AFFILIATE_NOTE_ACQUISITION", experimentId: "synthetic-new-experiment", measurementRecord: verified(), ...context() });

test("VERIFIED stores independent send/receive/QA evidence and permits only matching new note starts", () => {
  assert.equal(validateMeasurementRecord(verified()).evidenceId, "synthetic-evidence");
  assert.equal(assertNewAffiliateNoteExperimentAllowed(start()).allowed, true);
  const original = JSON.stringify(start().measurementRecord);
  measurementAvailability(start().measurementRecord, context());
  assert.equal(JSON.stringify(start().measurementRecord), original);
});

test("unverified/unimplemented/missing/unknown status block starts", () => {
  for (const status of ["NOT_VERIFIED", "NOT_IMPLEMENTED", "UNKNOWN", null, undefined]) {
    const args = start(); args.measurementRecord.affiliateClickMeasurementStatus = status;
    assert.throws(() => assertNewAffiliateNoteExperimentAllowed(args));
  }
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), measurementRecord: null }), /NOT_VERIFIED/);
});

test("evidence for different LP/property/page or no receiving proof cannot verify", () => {
  for (const key of ["evidenceId", "verifiedBy", "verifiedPageHash", "verifiedAt", "expectedEventName"]) {
    const record = verified(); delete record[key];
    assert.throws(() => validateMeasurementRecord(record));
  }
  for (const change of [{ received: false }, { sent: false }, { receiveReference: "" }, { qaEventReference: "" }, { targetLP: "https://other.test/" }, { ga4PropertyReference: "other" }, { receivedAt: "2026-10-02T00:00:00Z" }]) {
    const record = verified(); Object.assign(record.evidence, change);
    assert.throws(() => validateMeasurementRecord(record));
  }
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), currentPageHash: "0".repeat(64) }), /NOT_VERIFIED/);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), ga4PropertyReference: "different" }), /NOT_VERIFIED/);
});

test("retroactive evidence and future/invalidated/expired proofs do not verify", () => {
  const record = verified(); record.applicablePeriod.start = "2026-09-29";
  assert.throws(() => validateMeasurementRecord(record), /過去/);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), at: "2026-09-29T00:00:00Z" }), /NOT_VERIFIED/);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), at: "2026-11-01T00:00:00Z" }), /NOT_VERIFIED/);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), measurementRecord: verified({ invalidatedAt: "2026-10-10T00:00:00Z" }) }), /NOT_VERIFIED/);
});

test("historical coverage uses applicablePeriod, not only current VERIFIED state", () => {
  const result = measurementAvailability(verified(), { ...context(), period: { start: "2026-09-01", end: "2026-10-10" } });
  assert.equal(result.status, "NOT_VERIFIED");
  assert.equal(result.reason, "PERIOD_NOT_VERIFIED");
});

test("same-day verified new start is allowed after proof; earlier hours and whole-day totals are not verified", () => {
  const record = verified({ applicablePeriod: { start: "2026-09-30", end: "2026-10-31" } });
  assert.equal(assertNewAffiliateNoteExperimentAllowed({ ...start(), measurementRecord: record, at: "2026-09-30T04:00:00Z" }).allowed, true);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), measurementRecord: record, at: "2026-09-30T02:00:00Z" }), /NOT_VERIFIED/);
  assert.equal(measurementAvailability(record, { ...context(), period: { start: "2026-09-30", end: "2026-10-01" } }).status, "NOT_VERIFIED");
});

test("note-native and missing experiment ID are never accepted by Affiliate note gate", () => {
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), purpose: "NOTE_NATIVE_MONETIZATION" }), /専用/);
  assert.throws(() => assertNewAffiliateNoteExperimentAllowed({ ...start(), experimentId: "" }), /experimentId/);
});
