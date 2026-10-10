import { test } from "node:test";
import assert from "node:assert/strict";
import { measurementPeriod, measurementSummary } from "../daily-measurement.js";

const pages = [{ startDate: "2026-09-10", reviewDate: "2026-11-04" }];
test("daily measurement uses JST and three-day margin; does not silently extend an expired trial", () => {
  assert.deepEqual(measurementPeriod(pages, new Date("2026-10-10T23:37:00Z")), { from: "2026-09-10", to: "2026-10-08" });
  assert.throws(() => measurementPeriod(pages, new Date("2026-11-08T00:00:00Z")), /period ended/);
});
test("missing API data stays UNKNOWN while successful zero values remain zero", () => {
  const summary = measurementSummary({ requestedPeriod: { from: "2026-09-10", to: "2026-10-08" }, pages: [
    { slug: "missing", urlInspection: { status: "INDEX_STATUS_NOT_AVAILABLE" }, searchConsole: { status: "NOT_AVAILABLE" }, ga4: { status: "NOT_AVAILABLE" } },
    { slug: "zero", urlInspection: { status: "OK", indexStatus: "PASS" }, searchConsole: { status: "OK", impressions: 0, clicks: 0 }, ga4: { status: "OK", screenPageViews: 0, affiliateClickEventCount: 0 } },
    { slug: "unindexed", urlInspection: { status: "OK", indexStatus: "NEUTRAL" }, searchConsole: { status: "OK", impressions: 0, clicks: 0 }, ga4: { status: "OK", screenPageViews: 1, affiliateClickEventCount: 0 } },
  ] });
  assert.equal(summary.unavailable, 1);
  assert.equal(summary.notIndexed, 1);
  assert.match(summary.markdown, /missing \| UNKNOWN \| UNKNOWN/);
  assert.match(summary.markdown, /zero \| 登録済み \| 0 \| 0 \| 0 \| 0/);
});
