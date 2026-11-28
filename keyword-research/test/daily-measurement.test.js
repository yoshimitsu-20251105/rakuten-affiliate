import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { closedDateBoundary, rakutenSnapshot, runDailyMeasurement } from "../../experiment-measurement/daily.js";
import { createPrivateObjectStore } from "../../experiment-measurement/private-storage.js";
import { JAPANESE_FIELDS, ORDER_FIELDS } from "../../funnel-measurement/rakuten-order.js";

const targetUrl = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html";
const config = {
  approved: true, experimentId: "test-experiment", targetUrl,
  day0: "2026-11-26", ga4Timezone: "Asia/Tokyo",
  baseline: { startDate: "2026-10-29", endDate: "2026-11-25", impressions: 8, clicks: 0 },
};
const now = new Date("2026-12-26T00:00:00Z");
const observations = [
  { date: "2026-11-26", impressions: 1, clicks: 0, averagePosition: 5 },
  { date: "2026-11-27", impressions: 99, clicks: 8, averagePosition: 7, affiliateClicks: 8 },
  { date: "2026-12-24", impressions: 2, clicks: 0, averagePosition: 8, organicEngagedSessions: 1 },
];

function fixture(initial = []) {
  const data = new Map(initial);
  const storage = {
    read: async (key) => data.get(key) ?? null,
    latest: async (prefix, before) => [...data.entries()].filter(([key, value]) =>
      key.startsWith(prefix) && value.asOf < before).sort(([a], [b]) => b.localeCompare(a))[0]?.[1] ?? null,
    create: async (key, value) => {
      if (data.has(key)) return "ALREADY_EXISTS";
      data.set(key, value);
      return "CREATED";
    },
  };
  return { storage, data };
}

test("Tokyo morning caps collection at the last complete day in both source calendars", () => {
  assert.equal(closedDateBoundary(now, config.ga4Timezone), "2026-12-25");
  assert.equal(closedDateBoundary(new Date("2026-12-25T23:59:00Z"), "America/New_York"), "2026-12-25");
});

test("daily report preserves QA exclusions, unknowns, finality and separate baseline", async () => {
  const { storage, data } = fixture();
  let calls = 0;
  const collect = async (scope) => {
    calls++;
    assert.deepEqual(scope, { targetUrl, startDate: "2026-11-26", endDate: "2026-12-24" });
    return { ok: true, rows: observations, status: { gsc: "OBSERVED" } };
  };
  assert.equal(await runDailyMeasurement({ config, now, storage, collect }), "CREATED");
  assert.equal(await runDailyMeasurement({ config, now, storage, collect }), "ALREADY_EXISTS");
  assert.equal(calls, 1);
  const saved = data.get("daily/test-experiment/2026-12-25.json");
  assert.equal(saved.report.decision, "HOLD");
  assert.equal(saved.report.cumulative.totals.impressions, null);
  assert.deepEqual(saved.report.cumulative.excluded, ["2026-11-27"]);
  assert.equal(saved.report.baselineComparison.baseline.impressions, 8);
  assert.equal(saved.rolling[28].previous, null);
  assert.equal(saved.rolling[28].delta.impressions, null);
  assert.deepEqual(saved.rolling[7].current.awaitingFinalDataByMetric.organicEngagedSessions,
    ["2026-12-22", "2026-12-23", "2026-12-24"]);
  assert.equal(saved.checkpoints[28].through, "2026-12-24");
  assert.equal(saved.checkpoints[28].decision, "HOLD");
  assert.equal(saved.rakuten.metrics, null);
});

test("refresh replaces overlapping observations and bridges missed runs", async () => {
  const prefix = "daily/test-experiment/";
  const prior = { ...config, asOf: "2026-12-10", rows: [
    observations[0], { date: "2026-12-09", impressions: 2, clicks: 0, averagePosition: 3 },
  ] };
  const { storage, data } = fixture([[prefix + prior.asOf + ".json", prior]]);
  const collect = async ({ startDate, endDate }) => {
    assert.equal(startDate, "2026-12-10");
    assert.equal(endDate, "2026-12-24");
    return { ok: true, rows: [observations[2]] };
  };
  assert.equal(await runDailyMeasurement({ config, now, storage, collect }), "CREATED");
  assert.deepEqual(data.get(prefix + "2026-12-25.json").rows.map((x) => x.date),
    ["2026-11-26", "2026-12-09", "2026-12-24"]);
  assert.equal(data.size, 2);
  const nextNow = new Date("2026-12-27T00:00:00Z");
  const nextCollect = async ({ startDate }) => {
    assert.equal(startDate, "2026-12-19");
    return { ok: true, rows: [{ ...observations[2], impressions: 5 }] };
  };
  assert.equal(await runDailyMeasurement({ config, now: nextNow, storage, collect: nextCollect }), "CREATED");
  assert.deepEqual(data.get(prefix + "2026-12-26.json").rows.filter((x) => x.date === "2026-12-24"),
    [{ ...observations[2], impressions: 5 }]);
});

test("unauthorized start, malformed data and provider failure create no snapshot", async () => {
  const { storage, data } = fixture();
  const collect = async () => ({ ok: false, status: { gsc: "PERMISSION_DENIED" } });
  await assert.rejects(runDailyMeasurement({ config: { ...config, approved: false }, now, storage, collect }), /APPROVED_EXPERIMENT/);
  assert.equal(await runDailyMeasurement({ config: { ...config, day0: "2026-12-25" }, now, storage, collect }),
    "AWAITING_COMPLETE_DAY");
  await assert.rejects(runDailyMeasurement({ config, now, storage, collect }), /COLLECTION_FAILED/);
  await assert.rejects(runDailyMeasurement({ config, now, storage, collect: async () => ({
    ok: true, rows: [{ date: "2026-12-20", impressions: -1 }],
  }) }), /Invalid impressions/);
  assert.equal(data.size, 0);
});

test("official CSV is validated and only an exclusive mapping yields an occurrence snapshot", () => {
  const csv = [
    "注文別成果,2026.12", JAPANESE_FIELDS.join(","), ORDER_FIELDS.join(","),
    "2026-12-04,120,4,3000,pets,shop,item,1,link,pc,exclusive",
  ].join("\n");
  const metadata = {
    reportLabel: "2026.12", accountScopeId: "private-test", currency: "JPY", timezone: "Asia/Tokyo",
    coverage: "COMPLETE", sourceReference: "private fixture", dateBasis: "OCCURRENCE_DATE",
    snapshotAsOf: "2026-12-24T00:00:00Z", retrievedAt: "2026-12-25T00:00:00Z",
    inputMode: "SNAPSHOT", filters: {}, isSynthetic: false,
  };
  assert.equal(rakutenSnapshot({ csv, metadata }, config, now).status, "UNATTRIBUTABLE");
  const mapped = { ...config, rakuten: {
    accountScopeId: "private-test", measurementId: "exclusive", targetLP: targetUrl,
    exclusiveToLP: true, evidenceReference: "fixture-mapping", validFrom: "2026-12-01", validThrough: "2026-12-31",
  } };
  const report = rakutenSnapshot({ csv, metadata }, mapped, now);
  assert.equal(report.status, "OCCURRENCE_SNAPSHOT");
  assert.equal(report.metrics.approvedRevenue.value, 120);
  assert.equal(report.metrics.conversions.value, null);
  assert.throws(() => rakutenSnapshot({ csv, metadata: { ...metadata, isSynthetic: true } }, mapped, now), /INVALID_RAKUTEN_SOURCE/);
});

test("private uploads require create-only generation and do not overwrite duplicates", async () => {
  let count = 0;
  const object = createPrivateObjectStore({ bucket: "private-measurement", accessToken: "fixture", fetchImpl: async (url, request) => {
    count++;
    assert.equal(new URL(url).hostname, "storage.googleapis.com");
    assert.equal(new URL(url).searchParams.get("ifGenerationMatch"), "0");
    assert.equal(request.method, "POST");
    assert.equal(request.redirect, "error");
    return new Response(null, { status: count === 1 ? 200 : 412 });
  } });
  assert.equal(await object.create("daily/example/2026-11-28.json", { asOf: "2026-11-28" }), "CREATED");
  assert.equal(await object.create("daily/example/2026-11-28.json", {}), "ALREADY_EXISTS");
});

test("schedule is a review template with explicit enable gate and no public artifact upload", async () => {
  const source = await readFile(new URL("../../experiment-measurement/collect-google-measurement-daily.yml.example", import.meta.url), "utf8");
  assert.match(source, /cron: '0 0 \* \* \*'/);
  assert.match(source, /github\.ref == 'refs\/heads\/master'/);
  assert.match(source, /github\.event_name == 'schedule'/);
  assert.match(source, /DAILY_MEASUREMENT_ENABLED == 'true'/);
  assert.match(source, /if: failure\(\)/);
  assert.doesNotMatch(source, /upload-artifact|pages: write|contents: write/);
});
