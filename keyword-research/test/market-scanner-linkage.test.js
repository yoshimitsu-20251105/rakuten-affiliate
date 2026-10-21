import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scanManifest } from "../../market-scanner/report.js";
import { setup, source, TARGET, funnelReport, mapping, proof } from "./market-scanner-helpers.js";

async function base(t) {
  const data = await setup(t);
  await data.write("q.csv", "keyword,monthlySearches\nシニア 猫 フード,10\n");
  await data.write("lp.json", { pages: [{ slug: "scanner-test", path: "rankings/scanner-test.html", title: "synthetic" }] });
  const manifest = { schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv"), source("lp", "lp_inventory", "lp.json")], links: [{ keyword: "シニア 猫 フード", theme: "synthetic theme", targetLP: TARGET, evidenceReference: "synthetic declared association" }] };
  return { ...data, manifest };
}

test("LP local existence != live availability; old offer snapshot != current price or stock", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("offers.json", [{ itemCode: "synthetic:1", itemPrice: 1000, itemUrl: "https://example.test/item" }]);
  manifest.sources.push(source("offers", "offers", "offers.json")); manifest.links[0].itemCodes = ["synthetic:1"];
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.availableLPs[0].repositoryPresence.value, true);
  assert.equal(c.availableLPs[0].liveAvailability.value, null);
  assert.equal(c.availableLPs[0].relevance.evidenceType, "HYPOTHESIS");
  assert.equal(c.existingOffers[0].recordedPrice, 1000);
  assert.equal(c.existingOffers[0].snapshotDate, null);
  assert.equal(c.existingOffers[0].currentPrice.value, null);
  assert.equal(c.existingOffers[0].currentAvailability.value, null);
  assert.equal(c.existingOffers[0].productLinkRecorded, true);
  assert.equal(c.existingOffers[0].affiliateLinkRecorded, false);
});

test("seasonality remains hypothesis and empty competitors remain unknown", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("seasons.json", { items: [{ id: "season", theme: "synthetic theme", confidence: "HYPOTHESIS", peakMonths: [10], leadTimeDays: null }] });
  await write("competitors.json", { items: [] });
  manifest.sources.push(source("seasons", "seasonality", "seasons.json"), source("competitors", "competitors", "competitors.json"));
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.seasonality.value[0].evidenceType, "HYPOTHESIS");
  assert.equal(c.seasonality.value[0].leadTimeDays, null);
  assert.equal(c.competition.organicSerpEvidence.value, null);
});

test("existing RUNNING/INCONCLUSIVE/KILL and decisions are read only, never restarted or rewritten", async (t) => {
  const { write, options, manifest } = await base(t);
  const records = [{ experimentId: "running", status: "RUNNING", targetUrls: [TARGET], result: null }, { experimentId: "inconclusive", status: "INCONCLUSIVE", targetUrls: [TARGET], decision: "IMPROVE" }, { experimentId: "killed", status: "STOPPED", targetUrls: [TARGET], decision: "KILL" }];
  const path = await write("experiments.json", { items: records });
  await write("decisions.json", { items: [{ decisionId: "decision", relatedExperimentIds: ["running"], decision: "KEEP_FIXED" }] });
  const before = await readFile(path);
  manifest.sources.push(source("experiments", "experiments", "experiments.json"), source("decisions", "decisions", "decisions.json"));
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.deepEqual(c.relatedExperiments.map((e) => e.status), ["RUNNING", "INCONCLUSIVE", "STOPPED"]);
  assert(c.reviewFlags.includes("RUNNING_EXPERIMENT")); assert(c.reviewFlags.includes("PREVIOUSLY_KILLED_REVIEW_REQUIRED"));
  assert.equal(c.priorDecisions[0].decisionId, "decision");
  assert.deepEqual(await readFile(path), before);
});

test("unverified/unimplemented LP remains a candidate; verified evidence is checked but never starts experiment", async (t) => {
  const { write, options, manifest } = await base(t);
  let c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.measurementReadiness[0].affiliateClickMeasurementStatus, "NOT_VERIFIED");
  await write("measurement.json", { items: [{ targetLP: TARGET, affiliateClickMeasurementStatus: "NOT_IMPLEMENTED" }] });
  manifest.sources.push(source("measurement", "measurement_records", "measurement.json"));
  c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.measurementReadiness[0].affiliateClickMeasurementStatus, "NOT_IMPLEMENTED");
  await write("measurement.json", { items: [proof()] });
  const verifiedReport = await scanManifest(manifest, options);
  c = verifiedReport.candidates[0];
  assert.equal(c.measurementReadiness[0].affiliateClickMeasurementStatus, "VERIFIED");
  assert.equal(c.measurementReadiness[0].canStartExperiment, false);
  const proofEvidence = verifiedReport.evidence.find((e) => e.evidenceId === c.measurementReadiness[0].evidenceRefs[0]);
  assert.equal(proofEvidence.sourceId, "measurement");
  assert.equal(proofEvidence.value.evidence.receiveReference, "synthetic-receive");
  await write("docs/rankings/scanner-test.html", "changed offline HTML");
  c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.measurementReadiness[0].affiliateClickMeasurementStatus, "NOT_VERIFIED");
});

test("account ZERO_RECORD_SNAPSHOT is context only, not zero revenue for every candidate/ID", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("funnel.json", funnelReport({ records: false }));
  manifest.sources.push(source("funnel", "funnel_report", "funnel.json"));
  manifest.links[0].measurementIdMappings = [mapping()];
  const report = await scanManifest(manifest, options);
  assert.equal(report.runContext.funnelReports[0].report.metrics.revenue.value, 0);
  assert.equal(report.candidates[0].observedRevenueEvidence.revenue.value, null);
  assert.equal(report.candidates[0].observedRevenueEvidence.conversions.value, null);
});

test("observed ID + exclusive scope mapping can attach existing metric without estimating EPC/Conversions", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("funnel.json", funnelReport());
  manifest.sources.push(source("funnel", "funnel_report", "funnel.json")); manifest.links[0].measurementIdMappings = [mapping()];
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.observedRevenueEvidence.approvedRevenue.value, 500);
  assert.equal(c.observedRevenueEvidence.revenue.value, 500);
  assert.equal(c.observedRevenueEvidence.conversions.value, null);
  assert.equal(c.observedRevenueEvidence.conversions.validationStatus, "PARTIALLY_VERIFIED");
  assert.equal(c.observedRevenueEvidence.epc.value, null);
  const again = await scanManifest(manifest, options);
  const ref = again.candidates[0].observedRevenueEvidence.revenue.evidenceRefs[0];
  assert.equal(again.evidence.find((e) => e.evidenceId === ref).unit, "JPY");
  assert.equal(again.evidence.find((e) => e.evidenceId === ref).periodEnd, "2026-09-30");
  assert.equal(again.evidence.find((e) => e.evidenceId === ref).scope.observedScope.measurementId, "synthetic-note");
});

test("unproven/absent ID, account mismatch, period mismatch and future reports cannot allocate revenue", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("funnel.json", funnelReport()); manifest.sources.push(source("funnel", "funnel_report", "funnel.json"));
  for (const m of [mapping({ evidenceReference: null }), mapping({ measurementId: "missing" }), mapping({ accountScopeId: "other" }), mapping({ validThrough: "2026-09-15" }), mapping({ exclusiveToCandidate: false })]) {
    manifest.links[0].measurementIdMappings = [m];
    assert.equal((await scanManifest(manifest, options)).candidates[0].observedRevenueEvidence.revenue.value, null);
  }
  const future = funnelReport(); future.sourceBatch.snapshotAsOf = "2027-01-01T00:00:00Z"; await write("funnel.json", future);
  manifest.links[0].measurementIdMappings = [mapping()];
  assert.equal((await scanManifest(manifest, options)).candidates[0].observedRevenueEvidence.revenue.value, null);
});

test("shared IDs and multiple snapshots are not counted twice or summed", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("q.csv", "keyword\nシニア 猫 フード\nシニア 犬 フード\n");
  await write("funnel.json", funnelReport()); manifest.sources.push(source("funnel", "funnel_report", "funnel.json"));
  manifest.links[0].measurementIdMappings = [mapping()];
  manifest.links.push({ keyword: "シニア 犬 フード", targetLP: TARGET, measurementIdMappings: [mapping()] });
  let report = await scanManifest(manifest, options);
  assert.equal(report.candidates.length, 2);
  assert(report.candidates.every((c) => c.observedRevenueEvidence.revenue.value === null && c.reviewFlags.includes("SHARED_MEASUREMENT_ID")));
  manifest.links.pop(); await write("q.csv", "keyword\nシニア 猫 フード\n");
  const second = funnelReport(); second.sourceBatch.importId = "second-import"; await write("second.json", second);
  manifest.sources.push(source("second", "funnel_report", "second.json"));
  report = await scanManifest(manifest, options);
  assert.equal(report.candidates[0].observedRevenueEvidence.revenue.reason, "MULTIPLE_FUNNEL_SNAPSHOTS");
});

test("Funnel missing/partial/unknown metrics and currency are retained without zero substitution", async (t) => {
  const { write, options, manifest } = await base(t);
  const report = funnelReport();
  report.byMeasurementId[0].metrics.revenue = { ...report.byMeasurementId[0].metrics.revenue, value: null, availability: "INCOMPLETE", reason: "UNKNOWN_APPROVAL_STATUS", currency: "JPY" };
  report.byMeasurementId[0].metrics.approvedRevenue.availability = "PARTIAL";
  await write("funnel.json", report); manifest.sources.push(source("funnel", "funnel_report", "funnel.json")); manifest.links[0].measurementIdMappings = [mapping()];
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.observedRevenueEvidence.revenue.value, null);
  assert.equal(c.observedRevenueEvidence.revenue.reason, "UNKNOWN_APPROVAL_STATUS");
  assert.equal(c.observedRevenueEvidence.approvedRevenue.availability, "PARTIAL");
  assert.equal(c.observedRevenueEvidence.approvedRevenue.currency, "JPY");
});

test("synthetic Funnel cannot be promoted to real candidate revenue", async (t) => {
  const { write, options, manifest } = await base(t);
  manifest.sources[0].isSynthetic = false;
  await write("funnel.json", funnelReport());
  manifest.sources.push(source("funnel", "funnel_report", "funnel.json")); manifest.links[0].measurementIdMappings = [mapping()];
  const c = (await scanManifest(manifest, options)).candidates[0];
  assert.equal(c.isSynthetic, false);
  assert.equal(c.observedRevenueEvidence.revenue.value, null);
});

test("single saved LP proof shape is accepted and invalid proofs fail even without matching candidate", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("proof.json", proof()); manifest.sources.push(source("proof", "measurement_records", "proof.json"));
  assert.equal((await scanManifest(manifest, options)).candidates[0].measurementReadiness[0].affiliateClickMeasurementStatus, "VERIFIED");
  await write("proof.json", { ...proof(), expectedEventName: "wrong" });
  await assert.rejects(scanManifest(manifest, options));
});

test("conflicting values for the same Funnel import cannot silently choose the last report", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("funnel.json", funnelReport({ amount: 500 }));
  await write("conflict.json", funnelReport({ amount: 900 }));
  manifest.sources.push(source("funnel", "funnel_report", "funnel.json"), source("conflict", "funnel_report", "conflict.json"));
  manifest.links[0].measurementIdMappings = [mapping()];
  await assert.rejects(scanManifest(manifest, options), /競合/);
});

test("unsafe LP inventory path is rejected without reading or modifying outside docs", async (t) => {
  const { write, options, manifest } = await base(t);
  await write("lp.json", { pages: [{ path: "../../private.txt", slug: "bad" }] });
  await assert.rejects(scanManifest(manifest, options));
});
