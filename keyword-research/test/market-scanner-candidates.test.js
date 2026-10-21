import test from "node:test";
import assert from "node:assert/strict";
import { scanManifest } from "../../market-scanner/report.js";
import { setup, source, AS_OF } from "./market-scanner-helpers.js";

test("duplicates do not create extra demand; periods keep independent observations, never sum/max", async (t) => {
  const { write, options } = await setup(t);
  await write("a.csv", "keyword,monthlySearches\nシニア 猫 フード,100\n");
  await write("b.csv", "keyword,monthlySearches\nシニア 猫 フード,500\n");
  const report = await scanManifest({ schemaVersion: 1, sources: [source("a", "manual_csv", "a.csv"), source("copy", "manual_csv", "a.csv"), source("b", "manual_csv", "b.csv", { periodStart: "2026-08-01", periodEnd: "2026-08-31" })] }, options);
  assert.equal(report.candidates.length, 1);
  const c = report.candidates[0];
  assert.equal(c.demandEvidence.length, 2);
  const values = c.demandEvidence.map((id) => report.evidence.find((e) => e.evidenceId === id).value).sort((a, b) => a - b);
  assert.deepEqual(values, [100, 500]);
  assert(!JSON.stringify(c).includes('"score"')); assert(!JSON.stringify(c).includes('"rank"'));
  assert(report.evidence.some((e) => e.additionalSources?.some((s) => s.sourceId === "copy")));
});

test("semantic order, species/life-stage, geography and synthetic status are not blindly merged", async (t) => {
  const { write, options } = await setup(t);
  await write("queries.csv", "keyword,country,language\n猫 犬 フード,JP,ja\n犬 猫 フード,JP,ja\nシニア 猫 フード,JP,ja\n子猫 フード,JP,ja\nシニア 猫 フード,US,en\n");
  const report = await scanManifest({ schemaVersion: 1, sources: [source("q", "manual_csv", "queries.csv")] }, options);
  assert.equal(report.candidates.length, 5);
  const a = report.candidates.find((c) => c.keywords[0].original === "猫 犬 フード");
  const b = report.candidates.find((c) => c.keywords[0].original === "犬 猫 フード");
  assert.equal(a.keywords[0].canonicalForReferenceOnly, b.keywords[0].canonicalForReferenceOnly);
  assert.notEqual(a.candidateId, b.candidateId);
});

test("unknown demand/competition/intent are preserved; candidate is not silently filtered or scored", async (t) => {
  const { write, options } = await setup(t);
  await write("minimal.csv", "keyword\n任意テーマ\n猫 腎臓 フード\n123\n");
  const report = await scanManifest({ schemaVersion: 1, sources: [source("q", "manual_csv", "minimal.csv")] }, options);
  assert.equal(report.candidates.length, 3);
  const c = report.candidates.find((c) => c.keywords[0].original === "任意テーマ");
  assert.equal(c.intent.value, null); assert.equal(c.purchaseIntent.value, null);
  assert.equal(c.competition.organicSerpEvidence.value, null);
  assert.equal(c.observedRevenueEvidence.revenue.value, null);
  assert(c.unknowns.includes("DEMAND_NOT_OBSERVED"));
  assert(report.candidates.some((c) => c.reviewFlags.includes("MEDICAL_REVIEW_REQUIRED")));
  assert(report.candidates.some((c) => c.reviewFlags.includes("MALFORMED")));
});

test("existing opportunity IDs, hypothesis/counter-evidence and unknowns survive without treating score as evidence", async (t) => {
  const { write, options } = await setup(t);
  const row = { id: "senior-cat", name: "シニア猫フード", searchVolume: 5000, trafficScore: 99, opportunityScore: 100, hypothesis: "synthetic hypothesis", counterEvidence: ["synthetic counter"], unknowns: ["CVR unknown"] };
  await write("opps.json", { items: [row] });
  const manifest = { schemaVersion: 1, sources: [source("opps", "opportunities", "opps.json", { periodStart: null, periodEnd: null })] };
  const report = await scanManifest(manifest, options);
  const c = report.candidates[0];
  assert.deepEqual(c.opportunityIds, ["senior-cat"]);
  assert(c.counterEvidence.includes("synthetic counter")); assert(c.unknowns.includes("CVR unknown"));
  assert.equal(c.hypotheses[0].value, "synthetic hypothesis");
  assert.equal(c.hypotheses[0].evidenceType, "HYPOTHESIS");
  assert.equal(report.evidence.find((e) => e.metricOrClaim === "monthlySearches").value, 5000);
  assert.equal(report.evidence.find((e) => e.metricOrClaim === "monthlySearches").periodEnd, null);
  assert(!JSON.stringify(c).includes("opportunityScore"));
});

test("source freshness policy uses original retrieval/period; parsing later does not refresh old evidence", async (t) => {
  const { write, options } = await setup(t);
  await write("old.csv", "keyword,monthlySearches\n猫 フード,10\n");
  const manifest = { schemaVersion: 1, sources: [source("old", "manual_csv", "old.csv", { retrievedAt: "2025-01-01T00:00:00Z", periodStart: "2024-01-01", periodEnd: "2024-12-31" })], freshnessPolicy: { old: { maxRetrievedAgeDays: 30, maxPeriodAgeDays: 30 } } };
  const a = await scanManifest(manifest, options);
  const b = await scanManifest(manifest, { ...options, generatedAt: "2026-10-22T00:00:00Z" });
  assert.equal(a.candidates[0].evidenceFreshness[0].status, "STALE");
  assert.equal(b.candidates[0].evidenceFreshness[0].retrievedAt, "2025-01-01T00:00:00.000Z");
  assert.equal(a.evidence[0].evidenceType, b.evidence[0].evidenceType);
  assert(a.evidence.some((e) => e.evidenceType === "ESTIMATE" && e.value === 10));
  const noPolicy = await scanManifest({ ...manifest, freshnessPolicy: undefined }, options);
  assert.equal(noPolicy.candidates[0].evidenceFreshness[0].status, "FRESHNESS_NOT_EVALUATED");
});

test("explicit mapping may associate opportunity/query; conflicting mappings fail closed", async (t) => {
  const { write, options } = await setup(t);
  await write("q.csv", "keyword,monthlySearches\nシニア 猫 フード,10\n");
  await write("o.json", { items: [{ id: "senior-cat", name: "既存市場候補" }] });
  const base = { schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv"), source("o", "opportunities", "o.json")], links: [{ keyword: "シニア 猫 フード", opportunityId: "senior-cat" }] };
  const report = await scanManifest(base, options);
  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.candidates[0].opportunityIds, ["senior-cat"]);
  await assert.rejects(scanManifest({ ...base, links: [...base.links, { keyword: "シニア 猫 フード", opportunityId: "different" }] }, options), /複数市場/);
});
