import test from "node:test";
import assert from "node:assert/strict";
import { identifiers, identityKey, materialHash, linkPresent } from "../../acquisition-planner/tracking.js";
import { setup, run, fixture, affiliateLink, HTML, addOrder, MID } from "./acquisition-planner-helpers.js";

for (const c of (await fixture("cases")).channels) test(`Stable campaign/content and correct UTM applicability: ${c.channel}`, async () => {
  const b = await setup({ channel: c.channel }), first = run(b), second = run(b, { runId: "another-run", generatedAt: "2026-10-22T08:00:00Z" });
  const p = first.plans[0], q = second.plans[0]; assert.equal(first.planStatus, "READY");
  assert.equal(p.planId, q.planId); assert.equal(p.planRevisionHash, q.planRevisionHash); assert.equal(p.utm_source, c.source); assert.equal(p.utm_medium, c.medium);
  if (c.channel === "organic_search") { for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) assert.equal(p[k], null); assert.equal(p.plannedAcquisitionURL, p.targetLP); }
  else { assert.equal(p.utm_campaign, `amv2__${p.experimentId}__${c.channel}`); assert.equal(p.utm_content, "unit-01__v1"); }
});
test("Deterministic identity uses candidate as well as experiment/channel/contentUnit/variant", async () => {
  const b = await setup(), p = b.planningContext.plan, profile = { utmApplicable: true, source: "x", medium: "social" };
  const make = (v) => identifiers(v, profile, b.currentStateManifest.identityIndex, b.current.experimentsSnapshot, b.asOf);
  const first = make(p); assert.notEqual(make({ ...p, candidateId: "another-candidate" }).planId, first.planId);
  assert.notEqual(make({ ...p, contentUnit: "unit-02" }).utm_content, first.utm_content); assert.notEqual(make({ ...p, channel: "note" }).utm_campaign, first.utm_campaign);
});
test("Identity collision is blocked without fallback token or time suffix", async () => {
  const b = await setup(), p = b.planningContext.plan, r = run(b).plans[0];
  b.currentStateManifest.identityIndex.entries.push({ ...identityKey(p), targetLP: p.targetLP, utm_campaign: r.utm_campaign, utm_content: r.utm_content, materialHash: "0".repeat(64) });
  const after = run(b); assert.equal(after.planStatus, "BLOCKED"); assert.equal(after.plans[0].utm_campaign, r.utm_campaign); assert(after.blockingReasons.some((r) => r.code === "IDENTITY_REUSED_FOR_CHANGED_CONDITIONS"));
});
test("Same confirmed identity is idempotent; different candidate under same experiment is blocked", async () => {
  const b = await setup(), p = b.planningContext.plan, r = run(b).plans[0];
  const entry = { ...identityKey(p), targetLP: p.targetLP, utm_campaign: r.utm_campaign, utm_content: r.utm_content, materialHash: materialHash(p) };
  b.currentStateManifest.identityIndex.entries.push(entry); assert.equal(run(b).planStatus, "READY");
  entry.candidateId = "other"; assert.equal(run(b).planStatus, "BLOCKED");
});
test("Reserved delimiters and unknown identity coverage cannot be silently repaired", async () => {
  const b = await setup(); b.planningContext.plan.experimentId = "reserved__id"; const r = run(b);
  assert.equal(r.planStatus, "BLOCKED"); assert.equal(r.plans[0].planId, null);
  const n = await setup(); n.currentStateManifest.identityIndex.coverage = "UNKNOWN"; assert.equal(run(n).planStatus, "MANUAL_REVIEW_REQUIRED");
});
test("VERIFIED_EXISTING requires a current literal link and explicit parameter policy", async () => {
  const b = await setup(); assert.equal(run(b).plans[0].affiliateMeasurementIdStatus, "VERIFIED_EXISTING");
  b.planningContext.policy.providerPolicy = null; const r = run(b); assert.equal(r.plans[0].affiliateMeasurementIdStatus, "UNKNOWN"); assert.equal(r.plans[0].affiliateMeasurementId, null);
});
test("PROPOSED is not VERIFIED and never enables FACT Revenue attribution even with matching CSV", async () => {
  const b = await setup(); b.planningContext.measurementId = { proposedId: MID, binding: null }; addOrder(b);
  const p = run(b).plans[0]; assert.equal(p.affiliateMeasurementIdStatus, "PROPOSED"); assert.equal(p.affiliateMeasurementId, null); assert.equal(p.attributionEvidenceType, "UNKNOWN");
});
test("Verified link without CSV remains UNKNOWN for Revenue attribution", async () => {
  const p = run(await setup()).plans[0]; assert.equal(p.affiliateMeasurementIdStatus, "VERIFIED_EXISTING"); assert.equal(p.attributionEvidenceType, "UNKNOWN"); assert.equal(p.observedRevenueEvidence.records, null);
});
test("FACT ID evidence requires CSV and real-link connection; rewards and sales remain distinct", async () => {
  const b = await setup(); addOrder(b, [{ status: "0", id: MID, rewards: "100", amount: "10000" }, { status: "1", id: MID, rewards: "200", amount: "20000" }, { status: "2", id: MID, rewards: "50", amount: "5000" }]);
  const p = run(b).plans[0]; assert.equal(p.attributionEvidenceType, "FACT");
  assert.deepEqual(p.observedRevenueEvidence.records.map((r) => r.approvalStatus), ["PENDING", "APPROVED", "CANCELLED"]);
  assert.equal(p.observedRevenueEvidence.records[0].commissionAmount, 100); assert.equal(p.observedRevenueEvidence.records[0].merchandiseSalesAmount, 10000);
  for (const k of ["revenue", "approvedRevenue", "conversions", "epc", "channelRevenue", "experimentRevenue"]) assert.equal(p.observedRevenueEvidence[k], null);
});
test("Zero-record account snapshot never creates a new experiment zero", async () => {
  const b = await setup(); addOrder(b, []); const p = run(b).plans[0]; assert.equal(p.attributionEvidenceType, "UNKNOWN"); assert.equal(p.observedRevenueEvidence.revenue, null);
});
test("Different CSV ID or account is never allocated to this link", async () => {
  const b = await setup(); addOrder(b, [{ status: "1", id: "other-id" }]); assert.equal(run(b).plans[0].attributionEvidenceType, "UNKNOWN");
  addOrder(b); b.orderEvidence.metadata.accountScopeId = "other-account"; assert.equal(run(b).plans[0].attributionEvidenceType, "UNKNOWN");
});
test("Shared ID cannot become exclusive channel Revenue because UTMs differ", async () => {
  const b = await setup(); b.planningContext.measurementId.binding.exclusivity = "SHARED";
  // Both original protocol and context explicitly require the stronger scope.
  const p = b.original.selectionContext.proposals[0]; p.variables.acquisition.attributionScope = "EXPERIMENT_CHANNEL";
  const { run: selectorRun } = await import("./experiment-selector-helpers.js"); b.selectorReport = selectorRun(b.original); b.planningContext.plan.attributionScope = "EXPERIMENT_CHANNEL";
  b.current.selectionContext = structuredClone(b.original.selectionContext);
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "CHANNEL_REVENUE_BINDING_NOT_EXCLUSIVE"));
});
test("Requested new ID cannot modify the existing affiliate link", async () => {
  const b = await setup(); b.planningContext.measurementId.proposedId = "new-unconnected-id";
  const r = run(b); assert.equal(r.planStatus, "BLOCKED"); assert(r.blockingReasons.some((r) => r.code === "TRACKING_CHANGE_REQUIRED")); assert.equal(r.plans[0].affiliateMeasurementId, MID);
});
test("Duplicate measurement parameter cannot prove a unique binding", async () => {
  const b = await setup(); b.planningContext.measurementId.binding.affiliateLink += "&synthetic_mid=another"; assert.equal(run(b).plans[0].affiliateMeasurementIdStatus, "UNKNOWN");
});
test("Only live anchor markup in the saved document is accepted as literal link evidence", () => {
  assert(linkPresent(HTML, affiliateLink)); assert(linkPresent(`<a href='${affiliateLink.replace('&','&amp;')}'>ok</a>`, affiliateLink));
  for (const html of [`<!-- <a href="${affiliateLink}"> -->`, `<script>const x='<a href="${affiliateLink}">'</script>`, `<a data-href="${affiliateLink}">x</a>`,
    `<a title=" href='${affiliateLink}'">x</a>`, `<div data-html="<a href='${affiliateLink}'>">x</div>`, `<template><a href="${affiliateLink}">x</a></template>`]) assert(!linkPresent(html, affiliateLink), html);
});
test("Provider or link validity expiry removes verified state without relabelling proposed strings", async () => {
  const b = await setup(); b.planningContext.measurementId.binding.validPeriod.end = "2026-10-21";
  const r = run(b); assert.equal(r.plans[0].affiliateMeasurementIdStatus, "UNKNOWN"); assert.notEqual(r.planStatus, "READY");
});
test("A link binding covering only part of the CSV period does not establish full snapshot attribution", async () => {
  const b = await setup(); addOrder(b); b.planningContext.measurementId.binding.validPeriod.start = "2026-10-15";
  const p = run(b).plans[0]; assert.equal(p.affiliateMeasurementIdStatus, "VERIFIED_EXISTING"); assert.equal(p.attributionEvidenceType, "UNKNOWN");
});
test("Unknown CSV status remains UNKNOWN and never becomes an approved commission aggregate", async () => {
  const b = await setup(); addOrder(b, [{ status: "9", id: MID, rewards: "100", amount: "10000" }]);
  const p = run(b).plans[0]; assert.equal(p.observedRevenueEvidence.records[0].approvalStatus, "UNKNOWN"); assert.equal(p.observedRevenueEvidence.approvedRevenue, null);
});
test("Duplicate href attributes are not trusted as a unique affiliate link", () => {
  assert(!linkPresent(`<a href="${affiliateLink}" href="https://example.test/">x</a>`, affiliateLink));
});
