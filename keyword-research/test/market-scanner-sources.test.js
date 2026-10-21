import test from "node:test";
import assert from "node:assert/strict";
import { loadSources, strictCsv } from "../../market-scanner/sources.js";
import { scanManifest } from "../../market-scanner/report.js";
import { hash } from "../../market-scanner/model.js";
import { setup, source, fixture, AS_OF } from "./market-scanner-helpers.js";

test("GKP BOM/preamble/period: one CSV, no dog/cat pair or hardcoded region/synthetic override", async (t) => {
  const { write, options } = await setup(t);
  await write("gkp.csv", await fixture("market-scanner-gkp.csv"));
  const manifest = { schemaVersion: 1, sources: [source("gkp", "gkp_csv", "gkp.csv", { country: null, language: null, isSynthetic: true, periodStart: null, periodEnd: null })] };
  const [s] = await loadSources(manifest, options);
  assert.equal(s.observations.length, 2); assert.equal(s.periodStart, "2026-09-01");
  assert.equal(s.observations[0].monthlySearches, 1000);
  assert.equal(s.observations[1].monthlySearches, null);
  assert.equal(s.observations[1].rawValues.monthlySearches, "100〜1,000");
  assert.equal(s.country, null); assert.equal(s.language, null); assert.equal(s.isSynthetic, true);
  const report = await scanManifest(manifest, options);
  assert.equal(report.candidates.length, 2);
  assert(report.candidates.every((c) => c.reviewFlags.includes("SOURCE_REGION_UNKNOWN")));
  assert(report.evidence.some((e) => e.metricOrClaim === "monthlySearches" && e.evidenceType === "ESTIMATE" && e.value === 1000));
  assert(report.evidence.some((e) => e.value === null && e.rawValue === "100〜1,000"));
  assert(report.evidence.filter((e) => e.metricOrClaim.startsWith("ads_")).every((e) => e.reason === "ADS_BIDDING_PROXY_NOT_SEO_DIFFICULTY"));
});

test("manual null differs from actual zero; row periods and retrieval times survive reparse", async (t) => {
  const { write, options } = await setup(t);
  await write("manual.csv", "keyword,monthlySearches,impressions,clicks,periodStart,periodEnd,retrievedAt,country,language\n猫 フード,,0,0,2025-01-01,2025-01-31,2025-02-01T00:00:00Z,US,en\n");
  const report = await scanManifest({ schemaVersion: 1, sources: [source("manual", "manual_csv", "manual.csv")] }, options);
  const monthly = report.evidence.find((e) => e.metricOrClaim === "monthlySearches");
  assert.equal(monthly.value, null); assert.equal(monthly.evidenceType, "UNKNOWN");
  const impressions = report.evidence.find((e) => e.metricOrClaim === "impressions");
  assert.equal(impressions.value, 0); assert.equal(impressions.periodEnd, "2025-01-31");
  assert.equal(impressions.country, "US"); assert.equal(impressions.retrievedAt, "2025-02-01T00:00:00.000Z");
  assert.equal(impressions.parsedAt, AS_OF);
});

test("manual numeric claims need explicit evidence types; provider naming never promotes them to FACT", async (t) => {
  const { write, options } = await setup(t);
  await write("manual.csv", "keyword,monthlySearches,impressions,impressionsEvidenceType,evidenceType\n猫 フード,50,0,,\n犬 フード,20,4,FACT,ESTIMATE\n");
  const manifest = { schemaVersion: 1, sources: [source("manual", "manual_csv", "manual.csv", { provider: "google_search_console", evidenceType: undefined })] };
  const report = await scanManifest(manifest, options);
  const first = report.evidence.filter((e) => e.scope.keyword === "猫 フード" && e.metricOrClaim !== "theme_seed");
  assert(first.every((e) => e.evidenceType === "UNKNOWN"));
  assert.equal(first.find((e) => e.metricOrClaim === "impressions").value, 0);
  assert.equal(report.evidence.find((e) => e.scope.keyword === "犬 フード" && e.metricOrClaim === "monthlySearches").evidenceType, "ESTIMATE");
  assert.equal(report.evidence.find((e) => e.scope.keyword === "犬 フード" && e.metricOrClaim === "impressions").evidenceType, "FACT");
  await write("manual.csv", "keyword,impressions,evidenceType\n猫 フード,0,VERIFIED\n");
  await assert.rejects(scanManifest(manifest, options));
});

test("GSC report is own-site partial query evidence, not market search volume or note clicks", async (t) => {
  const { write, options } = await setup(t);
  await write("gsc.json", { runId: "saved", requestedPeriod: { from: "2026-09-01", to: "2026-09-30" }, pages: [{ pageUrl: "https://example.test/a", searchConsole: { status: "OK", topQueries: [{ query: "猫 フード", impressions: 0, clicks: 0, ctr: 0, averagePosition: 10 }] } }] });
  const report = await scanManifest({ schemaVersion: 1, sources: [source("gsc", "gsc_report", "gsc.json")] }, options);
  assert.equal(report.inputs[0].completeness, "PARTIAL");
  assert.equal(report.candidates.length, 1);
  assert(!report.evidence.some((e) => e.metricOrClaim === "monthlySearches"));
  assert.equal(report.evidence.find((e) => e.metricOrClaim === "impressions").scope.pageUrl, "https://example.test/a");
  assert.equal(report.candidates[0].observedRevenueEvidence.revenue.value, null);
});

test("GSC export aliases and percent parsing retain blank percent as null", async (t) => {
  const { write, options } = await setup(t);
  await write("gsc.csv", "上位のクエリ,クリック数,表示回数,ctr\n猫 フード,0,0,%\n犬 フード,2,10,20%\n");
  const [s] = await loadSources({ schemaVersion: 1, sources: [source("gsc", "gsc_csv", "gsc.csv")] }, options);
  assert.equal(s.observations[0].ctr, null); assert.equal(s.observations[1].ctr, 0.2);
});

test("missing input, malformed CSV/JSON/numeric/period and hash mismatch fail without fixture fallback", async (t) => {
  const { write, options } = await setup(t);
  await assert.rejects(loadSources({ schemaVersion: 1, sources: [] }, options));
  await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("absent", "manual_csv", "not-present.csv")] }, options), /SOURCE_READ_FAILED/);
  for (const content of ['keyword,clicks\n"bad,0\n', "keyword,clicks\n猫 フード,bad\n", "keyword,keyword\n猫,犬\n"]) {
    await write("bad.csv", content);
    await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("bad", "manual_csv", "bad.csv")] }, options));
  }
  await write("bad.json", "bad JSON");
  await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("bad", "opportunities", "bad.json")] }, options), /INVALID_JSON/);
  await write("ok.csv", "keyword\n猫 フード\n");
  await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("hash", "manual_csv", "ok.csv", { sourceFileHash: "0".repeat(64) })] }, options), /HASH_MISMATCH/);
  await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("date", "manual_csv", "ok.csv", { periodStart: "2026-02-30" })] }, options));
  assert.throws(() => strictCsv('a,"unclosed'), /引用符/);
});

test("source types never accept APIs or native note; valid empty CSV is distinct from omitted source", async (t) => {
  const { write, options } = await setup(t);
  await write("empty.csv", "keyword,monthlySearches\n");
  const manifest = { schemaVersion: 1, sources: [source("empty", "manual_csv", "empty.csv")] };
  const report = await scanManifest(manifest, options);
  assert.equal(report.status, "NO_CANDIDATES"); assert.equal(report.inputs[0].state, "EMPTY");
  assert.equal(report.inputs.find((s) => s.sourceType === "funnel_report").state, "NOT_PROVIDED");
  for (const change of [{ sourceType: "rakuten_api" }, { purpose: "NOTE_NATIVE_MONETIZATION" }]) await assert.rejects(scanManifest({ ...manifest, sources: [{ ...manifest.sources[0], ...change }] }, options));
});

test("UTF-16LE GKP is supported without importing scoring or network adapters", async (t) => {
  const { write, options } = await setup(t);
  // Independent tab fixture: no grouped numeric comma in this one.
  const content = "Stats\n2026-09-01 - 2026-09-30\nKeyword\tAvg. monthly searches\n猫 フード\t10\n";
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, "utf16le")]);
  await write("utf16.csv", bytes);
  const [s] = await loadSources({ schemaVersion: 1, sources: [source("gkp", "gkp_csv", "utf16.csv", { sourceFileHash: hash(bytes) })] }, options);
  assert.equal(s.encoding, "UTF-16LE"); assert.equal(s.observations[0].monthlySearches, 10);
});

test("explicit malformed JSON structures, invalid seasonality and bad freshness policies are rejected", async (t) => {
  const { write, options } = await setup(t);
  for (const [type, data] of [["opportunities", {}], ["seasonality", { items: [{ id: "s", confidence: "FACT", peakMonths: [13] }] }], ["experiments", { items: [{ experimentId: "e", status: "RUNNING", targetUrls: "bad" }] }]]) {
    await write("bad.json", data);
    await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("bad", type, "bad.json")] }, options));
  }
  await write("q.csv", "keyword\n猫 フード\n");
  for (const freshnessPolicy of [{ absent: { maxPeriodAgeDays: 1 } }, { q: { typo: 1 } }, { q: { maxPeriodAgeDays: -1 } }]) await assert.rejects(loadSources({ schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv")], freshnessPolicy }, options));
});
