import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectGoogleRows, createWifClients } from "../../experiment-measurement/google-live.js";
import { buildExperimentReport } from "../../experiment-measurement/report.js";

const input = {
  experimentId: "senior-cat",
  targetUrl: "https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html",
  startDate: "2026-11-26", endDate: "2026-11-28", asOf: "2026-11-29", day0: null,
};
const gaRow = (date, value) => ({ dimensionValues: [{ value: date }], metricValues: [{ value }] });
const gscRow = { keys: ["2026-11-26"], impressions: 4, clicks: 0, position: 8 };

function clients({ gsc = async () => ({ data: {} }), ga = async () => ({ data: {} }) } = {}) {
  return {
    searchconsole: { searchanalytics: { query: gsc } },
    analyticsdata: { properties: { runReport: ga } },
  };
}

test("requests exact page and read-only report scopes and connects observations to the experiment report", async () => {
  const observed = await collectGoogleRows({
    ...input, clients: clients({
      gsc: async ({ siteUrl, requestBody }) => {
        assert.equal(siteUrl, input.targetUrl.split("rankings/")[0]);
        assert.equal(requestBody.dataState, "final");
        assert.equal(requestBody.dimensionFilterGroups[0].filters[0].expression, input.targetUrl);
        return { data: { rows: [gscRow] } };
      },
      ga: async ({ property, requestBody }) => {
        assert.equal(property, "properties/550074703");
        assert.match(JSON.stringify(requestBody.dimensionFilter), /amv2_qa/);
        if (requestBody.metrics[0].name === "engagedSessions") {
          assert.match(JSON.stringify(requestBody.dimensionFilter), /Organic Search/);
          return { data: { rows: [gaRow("20261126", "0")] } };
        }
        assert.match(JSON.stringify(requestBody.dimensionFilter), /affiliate_click/);
        return { data: { rows: [gaRow("20261126", "2")] } };
      },
    }),
  });
  assert.equal(observed.ok, true);
  assert.deepEqual(observed.rows, [{
    date: "2026-11-26", impressions: 4, clicks: 0, averagePosition: 8,
    organicEngagedSessions: 0, affiliateClicks: 2,
  }]);
  const report = buildExperimentReport({ ...input, rows: observed.rows });
  assert.equal(report.requested.totals.impressions, null);
  assert.equal(report.requested.totals.conversions, null);
  assert.deepEqual(report.requested.excluded, ["2026-11-27"]);
  assert.equal(report.day0, null);
});

test("empty API results remain unknown", async () => {
  const result = await collectGoogleRows({ ...input, clients: clients() });
  assert.equal(result.ok, true);
  assert.equal(result.status.gsc, "NO_ROWS_RETURNED");
  assert.equal(result.status.ga4Affiliate, "NO_ROWS_RETURNED");
  assert.deepEqual(result.rows, []);
});

for (const [code, expected] of [[401, "UNAUTHENTICATED"], [403, "PERMISSION_DENIED"], [503, "FETCH_FAILED"]]) {
  test(`Google failure ${code} stops collection without returning partial measurements`, async () => {
    const result = await collectGoogleRows({
      ...input, clients: clients({
        gsc: async () => ({ data: { rows: [gscRow] } }),
        ga: async () => { throw { response: { status: code }, message: "must not be published" }; },
      }),
    });
    assert.deepEqual(result, { ok: false, status: { gsc: "OBSERVED", ga4Organic: expected, ga4Affiliate: expected } });
  });
}

test("duplicates and thresholded GA4 results cannot become measurements", async () => {
  await assert.rejects(collectGoogleRows({
    ...input, clients: clients({ gsc: async () => ({ data: { rows: [gscRow, gscRow] } }) }),
  }), /INVALID_DAILY_ROW/);
  const gaThreshold = await collectGoogleRows({
    ...input, clients: clients({ ga: async () => ({ data: { metadata: { subjectToThresholding: true } } }) }),
  });
  assert.equal(gaThreshold.ok, false);
});

test("CLI without bearer token stops before reading input or contacting Google", () => {
  assert.throws(() => createWifClients(""), /MISSING_ACCESS_TOKEN/);
  const env = { ...process.env, EXPERIMENT_GOOGLE_LIVE: "true" };
  delete env.EXPERIMENT_GOOGLE_ACCESS_TOKEN;
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL("../../experiment-measurement/google-live-cli.js", import.meta.url)), "unused-input.json",
  ],
  { env, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Google live collection stopped/);
});
