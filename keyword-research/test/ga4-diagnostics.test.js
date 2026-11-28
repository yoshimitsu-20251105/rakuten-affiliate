import assert from "node:assert/strict";
import test from "node:test";
import { collectGa4Diagnostics } from "../../experiment-measurement/ga4-diagnostics.js";

test("GA4 investigation queries property, host, page, channel, event, and breakdown separately", async () => {
  const queries = [];
  const response = await collectGa4Diagnostics({
    now: new Date("2026-11-28T10:00:00Z"), propertyTimezone: "Asia/Tokyo", confirmedThrough: "2026-11-24",
    client: { properties: { runReport: async (query) => {
      queries.push(query);
      const index = queries.length;
      return { data: {
        metadata: { timeZone: "Asia/Tokyo", ...(index === 6 ? { subjectToThresholding: true } : {}) },
        ...(index === 1 ? { rows: [{ metricValues: [{ value: "0" }] }] } : {}),
      } };
    } } },
  });
  assert.equal(queries.length, 6);
  assert(queries.every(({ property }) => property === "properties/550074703"));
  assert.deepEqual(response.range, { startDate: "2026-10-28", endDate: "2026-11-24" });
  assert.equal(queries[0].requestBody.dimensionFilter, undefined);
  assert.match(JSON.stringify(queries[1]), /hostName/);
  assert.match(JSON.stringify(queries[2]), /senior-cat-food/);
  assert.match(JSON.stringify(queries[3]), /Organic Search/);
  assert.match(JSON.stringify(queries[4]), /affiliate_click/);
  assert.equal(response.metrics.propertyViews.data, 0);
  assert.deepEqual(response.metrics.pageViews, { status: "NO_ROWS_RETURNED", data: null });
  assert.deepEqual(response.metrics.pageBreakdown, { status: "INCOMPLETE", data: null });
});

test("GA4 diagnostics stop on a mismatched property date calendar", async () => {
  await assert.rejects(collectGa4Diagnostics({
    now: new Date("2026-11-28T10:00:00Z"), propertyTimezone: "Asia/Tokyo", confirmedThrough: "2026-11-24",
    client: { properties: { runReport: async () => ({ data: { metadata: { timeZone: "America/Los_Angeles" } } }) } },
  }), /INVALID_GA4_DIAGNOSTICS_RESPONSE/);
});
