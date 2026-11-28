import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { collectGoogleRows, createWifClients } from "../../experiment-measurement/google-live.js";
import { runGoogleLiveCli } from "../../experiment-measurement/google-live-cli.js";
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
        const [host, page] = requestBody.dimensionFilter.andGroup.expressions;
        assert.deepEqual(host.filter, {
          fieldName: "hostName",
          stringFilter: { matchType: "EXACT", value: "yoshimitsu-20251105.github.io", caseSensitive: true },
        });
        assert.equal(page.andGroup.expressions[0].filter.stringFilter.value, new URL(input.targetUrl).pathname);
        assert.deepEqual(requestBody.dateRanges, [{ startDate: input.startDate, endDate: input.endDate }]);
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
  assert.deepEqual(JSON.parse(result.stderr), { error: "AUTH_ERROR" });
});

test("late GA4 dates stay pending while finalized zero and missing GSC remain distinct", async () => {
  const result = await collectGoogleRows({
    ...input, clients: clients({
      gsc: async () => ({ data: { rows: [gscRow] } }),
      ga: async () => ({ data: { rows: [gaRow("20261126", "0"), gaRow("20261128", "9")] } }),
    }),
  });
  assert.equal(result.ok, true);
  const report = buildExperimentReport({
    ...input, rows: result.rows,
    finalThrough: { organicEngagedSessions: "2026-11-26", affiliateClicks: "2026-11-26" },
  });
  assert.equal(report.requested.totals.organicEngagedSessions, null);
  assert.equal(report.requested.totals.affiliateClicks, null);
  assert.deepEqual(report.requested.awaitingFinalDataByMetric.affiliateClicks, ["2026-11-28"]);
  assert.deepEqual(report.requested.missingByMetric.impressions, ["2026-11-28"]);
  assert.equal(buildExperimentReport({
    ...input, endDate: "2026-11-26", rows: result.rows.filter((row) => row.date === "2026-11-26"),
  }).requested.totals.affiliateClicks, 0);
});

async function runCliFixture(t, provider, { scope = {}, stdoutError = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "google-live-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "input.json");
  await writeFile(path, JSON.stringify({ ...input, endDate: input.startDate, ...scope }));
  let out = "";
  let errors = "";
  const exitCode = await runGoogleLiveCli({
    args: [path],
    env: { EXPERIMENT_GOOGLE_LIVE: "true", EXPERIMENT_GOOGLE_ACCESS_TOKEN: "fixture-token" },
    createClients: () => provider,
    stdout: { write: (value) => {
      if (stdoutError) throw new Error("fixture private output path");
      out += value;
    } },
    stderr: { write: (value) => { errors += value; } },
  });
  return { exitCode, out, diagnostics: errors.trim().split("\n").map(JSON.parse) };
}

for (const [label, row] of [
  ["ranked result", gscRow],
  ["zero-impression position placeholder", { ...gscRow, impressions: 0, position: 0 }],
]) {
  test(`CLI emits a report for a GSC ${label} with both GA4 responses empty`, async (t) => {
    const result = await runCliFixture(t, clients({ gsc: async () => ({ data: { rows: [row] } }) }));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.diagnostics, [{
      gsc: "OBSERVED", ga4Organic: "NO_ROWS_RETURNED", ga4Affiliate: "NO_ROWS_RETURNED",
    }]);
    const report = JSON.parse(result.out);
    assert.equal(report.decision, "HOLD");
    assert.equal(report.day0, null);
    assert.equal(report.requested.totals.impressions, row.impressions);
    assert.equal(report.requested.totals.clicks, 0);
    assert.equal(report.requested.totals.averagePosition, row.position || null);
    assert.equal(report.requested.totals.organicEngagedSessions, null);
    assert.equal(report.requested.totals.affiliateClicks, null);
  });
}

test("CLI diagnoses invalid positive-impression position without logging its value", async (t) => {
  const result = await runCliFixture(t, clients({
    gsc: async () => ({ data: { rows: [{ ...gscRow, position: "fixture-private-value" }] } }),
  }));
  assert.equal(result.exitCode, 1);
  assert.equal(result.out, "");
  assert.deepEqual(result.diagnostics, [
    { gsc: "INVALID_RESPONSE", ga4Organic: "NO_ROWS_RETURNED", ga4Affiliate: "NO_ROWS_RETURNED" },
    { error: "RESPONSE_VALIDATION_ERROR", reasons: { gsc: "INVALID_GSC_AVERAGE_POSITION" } },
  ]);
});

test("CLI distinguishes inconsistent report counts, provider failures and output errors", async (t) => {
  const observed = clients({ gsc: async () => ({ data: { rows: [gscRow] } }) });
  for (const [provider, options, diagnostic] of [
    [clients({ gsc: async () => ({ data: { rows: [{ ...gscRow, clicks: 5 }] } }) }), {},
      { error: "REPORT_VALIDATION_ERROR", reason: "CLICKS_EXCEED_IMPRESSIONS" }],
    [observed, { scope: { startDate: "bad date" } },
      { error: "REPORT_VALIDATION_ERROR", reason: "INVALID_DATE" }],
    [clients({ gsc: async () => { throw { code: 403, message: "fixture credential" }; } }), {},
      { error: "AUTH_ERROR" }],
    [clients({ gsc: async () => { throw { code: 503, message: "fixture request" }; } }), {},
      { error: "FETCH_ERROR" }],
    [observed, { stdoutError: true }, { error: "REPORT_GENERATION_ERROR" }],
  ]) {
    const result = await runCliFixture(t, provider, options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.out, "");
    assert.deepEqual(result.diagnostics.at(-1), diagnostic);
  }
});
