import assert from "node:assert/strict";
import test from "node:test";
import { buildExperimentReport } from "../../experiment-measurement/report.js";

const input = {
  experimentId: "senior-cat",
  targetUrl: "https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/senior-cat-food.html",
  day0: null, startDate: "2026-11-27", endDate: "2026-11-28", asOf: "2026-11-29",
  baseline: { startDate: "2026-10-30", endDate: "2026-11-26", impressions: 8, clicks: 0 },
  rows: [
    { date: "2026-11-27", impressions: 99, clicks: 8, affiliateClicks: 1 },
    { date: "2026-11-28", impressions: 2, clicks: 0, averagePosition: 7 },
  ],
};

test("QA is excluded, observed zero and missing differ, and Day 0 stays unset", () => {
  const report = buildExperimentReport(input);
  assert.equal(report.day0, null);
  assert.equal(report.cumulative, null);
  assert.equal(report.requested.totals.impressions, 2);
  assert.equal(report.requested.totals.ctr, 0);
  assert.equal(report.requested.totals.affiliateClicks, null);
  assert.deepEqual(report.requested.excluded, ["2026-11-27"]);
  assert.equal(report.lastSevenDays.totals.impressions, null);
  assert.equal(report.decision, "HOLD");
});

test("baseline remains separate from experiment totals and checkpoints", () => {
  const report = buildExperimentReport({ ...input, day0: "2026-11-27" });
  assert.equal(report.checkpoints.day7, "2026-12-04");
  assert.equal(report.checkpoints.day14, "2026-12-11");
  assert.equal(report.checkpoints.day28, "2026-12-25");
  assert.equal(report.cumulative.totals.impressions, 2);
  assert.equal(report.baselineComparison.perDayDelta.impressions, 2 - 8 / 28);
});

test("duplicate rows, invalid dates and overlapping baselines are rejected", () => {
  assert.throws(() => buildExperimentReport({ ...input, rows: [input.rows[0], input.rows[0]] }), /duplicate/);
  assert.throws(() => buildExperimentReport({ ...input, endDate: "2026-11-31" }), /calendar/);
  assert.throws(() => buildExperimentReport({ ...input, baseline: { ...input.baseline, endDate: input.startDate } }), /baseline/);
});

test("provisional observations do not enter totals beyond an explicit source cutoff", () => {
  const report = buildExperimentReport({ ...input, finalThrough: { impressions: "2026-11-26" } });
  assert.equal(report.requested.totals.impressions, null);
  assert.equal(report.requested.totals.ctr, null);
  assert.deepEqual(report.requested.awaitingFinalDataByMetric.impressions, ["2026-11-28"]);
});
