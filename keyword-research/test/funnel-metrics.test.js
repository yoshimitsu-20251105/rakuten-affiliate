import test from "node:test";
import assert from "node:assert/strict";
import { parseRakutenOrder as parseOrder } from "../../funnel-measurement/rakuten-order.js";
import { aggregateRevenue, calculateEpc } from "../../funnel-measurement/metrics.js";
import { buildFunnelReport, renderFunnelMarkdown } from "../../funnel-measurement/report.js";
import { observation } from "../../funnel-measurement/model.js";
import { zeroBytes, meta, recordsBytes, analytics, analyticsMeta, targetLP, verified, pageHash } from "./funnel-helpers.js";

test("not imported differs from formal zero snapshot, never final monthly revenue", () => {
  assert.equal(aggregateRevenue(null).revenue.value, null);
  assert.equal(aggregateRevenue(null).revenue.availability, "NOT_IMPORTED");
  const snapshot = parseRakutenOrder(zeroBytes, meta());
  const metrics = aggregateRevenue(snapshot);
  for (const name of ["revenue", "approvedRevenue", "cancelledRevenue", "conversions", "merchandiseSales"]) assert.equal(metrics[name].value, 0);
  assert.equal(metrics.revenue.final, false);
  assert.equal(metrics.conversions.validationStatus, "PARTIALLY_VERIFIED");
  assert.equal(metrics.conversions.currency, undefined);
  const report = buildFunnelReport({ snapshot });
  assert.match(renderFunnelMarkdown(report), /ZERO_RECORD_SNAPSHOT/);
  assert.match(renderFunnelMarkdown(report), /最終値ではなく/);
  assert.deepEqual(report.byMeasurementId, []);
  assert.equal(aggregateRevenue(snapshot, { measurementId: "absent" }).revenue.value, null);
});

test("synthetic PENDING/APPROVED/CANCELLED: valid rewards only, no double subtraction", () => {
  const snapshot = parseRakutenOrder(recordsBytes([{ status: "0", rewards: "500", amount: "50000" }, { status: "1", rewards: "1000", amount: "100000" }, { status: "2", rewards: "200", amount: "20000" }]), meta());
  const metrics = aggregateRevenue(snapshot);
  assert.equal(metrics.revenue.value, 1500);
  assert.equal(metrics.approvedRevenue.value, 1000);
  assert.equal(metrics.cancelledRevenue.value, 200);
  assert.equal(metrics.merchandiseSales.value, 170000);
  assert.equal(metrics.conversions.value, null);
  assert.equal(metrics.revenue.isSynthetic, true);
  assert.equal(snapshot.batch.nonZeroRealDataVerified, false);
});

test("unknown status or missing commission does not silently become zero", () => {
  const unknown = aggregateRevenue(parseRakutenOrder(recordsBytes([{ status: "9" }]), meta()));
  assert.equal(unknown.revenue.value, null);
  assert.equal(unknown.approvedRevenue.reason, "UNKNOWN_APPROVAL_STATUS");
  assert.equal(unknown.merchandiseSales.value, 10000);
  const missing = aggregateRevenue(parseRakutenOrder(recordsBytes([{ rewards: "" }]), meta()));
  assert.equal(missing.revenue.value, null);
  assert.equal(missing.revenue.reason, "MISSING_AMOUNT");
});

test("partial source coverage never yields a complete zero or revenue", () => {
  const metrics = aggregateRevenue(parseRakutenOrder(zeroBytes, meta({ coverage: "PARTIAL" })));
  assert.equal(metrics.revenue.availability, "PARTIAL");
  assert.equal(metrics.conversions.value, null);
});

test("measurement ID requires an observed record and cannot allocate revenue to a channel", () => {
  const snapshot = parseRakutenOrder(recordsBytes([{ id: "note-a", rewards: "500" }, { id: "x-a", rewards: "200" }, { id: "", rewards: "300" }]), meta());
  const report = buildFunnelReport({ snapshot });
  assert.equal(report.metrics.revenue.value, 1000);
  assert.deepEqual(report.byMeasurementId.map((entry) => [entry.measurementId, entry.metrics.revenue.value]), [["note-a", 500], ["x-a", 200]]);
  assert.equal(report.attribution.channelRevenue.value, null);
  assert.equal(report.attribution.experimentRevenue.value, null);
  assert.equal(aggregateRevenue(snapshot, { measurementId: "made-up" }).revenue.availability, "UNATTRIBUTABLE");
});

test("EPC formula only when inputs are comparable and complete; zero is not missing", () => {
  const revenue = { ...observation(1200), currency: "JPY" };
  assert.equal(calculateEpc(revenue, observation(20), { compatible: true }).value, 60);
  assert.equal(calculateEpc(observation(0), observation(20), { compatible: true }).value, 0);
  assert.equal(calculateEpc(revenue, observation(0), { compatible: true }).availability, "NOT_CALCULABLE");
  assert.equal(calculateEpc(revenue, observation(20), { compatible: false, reason: "SCOPE_MISMATCH" }).value, null);
  assert.equal(calculateEpc(observation(null, "NOT_IMPORTED"), observation(20), { compatible: true }).value, null);
  assert.equal(calculateEpc(observation(100, "PARTIAL"), observation(20), { compatible: true }).value, null);
});

test("integrates saved GA4/GSC, retains CTR, does not equate period earnings with click-cohort EPC", () => {
  const snapshot = parseRakutenOrder(recordsBytes([{ id: "note-a" }]), meta());
  const report = buildFunnelReport({ snapshot, analyticsReport: analytics(), analyticsMetadata: analyticsMeta(), targetLP, measurementRecord: verified(), currentPageHash: pageHash });
  assert.equal(report.analytics.affiliateClicks.value, 20);
  assert.equal(report.analytics.affiliateCtr.value, 50);
  assert.equal(report.analytics.searchConsole.clicks, 0);
  assert.equal(report.analytics.trafficGrain, "SESSION_DEFAULT_CHANNEL_GROUP");
  assert.equal(report.metrics.epc.value, null);
  assert.match(renderFunnelMarkdown(report), /affiliateClickMeasurementStatus: VERIFIED/);
});

test("legacy zero with no verification remains null in new report; original data unchanged", () => {
  const source = analytics(); source.pages[0].ga4.affiliateClickEventCount = 0;
  const before = JSON.stringify(source);
  const report = buildFunnelReport({ analyticsReport: source, analyticsMetadata: analyticsMeta(), targetLP });
  assert.equal(report.analytics.affiliateClicks.value, null);
  assert.equal(report.analytics.measurement.status, "NOT_VERIFIED");
  assert.equal(report.analytics.affiliateClickByTrafficSource.values, null);
  assert.equal(JSON.stringify(source), before);
});

test("unknown freshness / QA contamination do not silently count clean clicks", () => {
  const args = { analyticsReport: analytics(), analyticsMetadata: analyticsMeta(), targetLP, measurementRecord: verified(), currentPageHash: pageHash };
  args.analyticsMetadata.dataCompleteThrough = null;
  assert.equal(buildFunnelReport(args).analytics.affiliateClicks.availability, "DELAYED");
  args.analyticsMetadata = { ...analyticsMeta(), qaExclusionStatus: "UNKNOWN" };
  assert.equal(buildFunnelReport(args).analytics.affiliateClicks.value, null);
});

test("even an exclusive ID and full matching calendar month cannot invent click-cohort attribution", () => {
  const snapshot = parseRakutenOrder(recordsBytes([{ id: "note-a" }]), meta({ snapshotAsOf: "2026-11-02T00:00:00Z", retrievedAt: "2026-11-02T00:01:00Z" }));
  const source = analytics(); source.requestedPeriod.to = "2026-10-31";
  const metadata = { ...analyticsMeta(), retrievedAt: "2026-11-03T00:00:00Z", dataCompleteThrough: "2026-10-31" };
  const report = buildFunnelReport({ snapshot, analyticsReport: source, analyticsMetadata: metadata, targetLP, measurementRecord: verified(), currentPageHash: pageHash,
    mapping: { accountScopeId: "synthetic-account", measurementId: "note-a", targetLP, exclusiveToLP: true, evidenceReference: "synthetic-exclusive-map", validFrom: "2026-10-01", validThrough: "2026-10-31" } });
  assert.equal(report.metrics.epc.value, null);
  assert.equal(report.attribution.epcCompatibility.reason, "CLICK_COHORT_LINK_NOT_AVAILABLE_IN_ORDER_CSV");
});

function parseRakutenOrder(bytes, metadata) { return parseOrder(bytes, metadata, { importedAt: "2026-12-01T00:00:00Z" }); }
