import { assert, assertDate, assertTimestamp, canonicalLP, hash, observation } from "./model.js";
import { measurementAvailability } from "./measurement-status.js";

// Only reads an existing saved report. No Google client, auth file, or fetch import.
export function readAnalyticsObservation(report, metadata, { targetLP, measurementRecord = null, currentPageHash = null }) {
  canonicalLP(targetLP);
  assert(report && typeof report.runId === "string" && Array.isArray(report.pages), "既存analytics report形式が不正です");
  assertDate(report.requestedPeriod?.from, "analytics.from"); assertDate(report.requestedPeriod?.to, "analytics.to");
  assert(report.requestedPeriod.from <= report.requestedPeriod.to, "analytics期間が逆です");
  assertTimestamp(metadata.retrievedAt, "analytics.retrievedAt");
  assert(typeof metadata.sourceReference === "string" && metadata.sourceReference.trim(), "analytics.sourceReferenceが必要です");
  assert(typeof metadata.ga4PropertyReference === "string" && metadata.ga4PropertyReference.trim(), "analytics.ga4PropertyReferenceが必要です");
  assert(typeof metadata.timezone === "string" && metadata.timezone.trim(), "analytics.timezoneが必要です(UNKNOWNは比較不可)");
  assert(metadata.dataCompleteThrough === null || /^\d{4}-\d{2}-\d{2}$/.test(metadata.dataCompleteThrough ?? ""), "analytics.dataCompleteThroughは日付またはnullです");
  if (metadata.dataCompleteThrough) assertDate(metadata.dataCompleteThrough, "analytics.dataCompleteThrough");
  const pages = report.pages.filter((page) => page.pageUrl === targetLP);
  assert(pages.length <= 1, "analyticsの対象LPが重複しています");
  const page = pages[0];
  const period = { start: report.requestedPeriod.from, end: report.requestedPeriod.to };
  const measurement = measurementAvailability(measurementRecord, { targetLP, currentPageHash, ga4PropertyReference: metadata.ga4PropertyReference, period, at: metadata.retrievedAt });
  const context = { period, timezone: metadata.timezone, provider: "GA4", targetLP, sourceReference: metadata.sourceReference, retrievedAt: metadata.retrievedAt, runId: report.runId, reportHash: hash(JSON.stringify(report)) };
  function gaMetric(field, requireVerification = false) {
    if (!page || page.ga4?.status !== "OK") return observation(null, "NOT_AVAILABLE", "GA4_PAGE_NOT_AVAILABLE", context);
    if (requireVerification && measurement.status !== "VERIFIED") return observation(null, measurement.status, measurement.reason, context);
    const value = page.ga4[field];
    assert(Number.isSafeInteger(value) && value >= 0, `analytics ${field}が不正です`);
    if (!metadata.dataCompleteThrough || metadata.dataCompleteThrough < period.end) return observation(null, "DELAYED", "DATA_COMPLETENESS_NOT_CONFIRMED", context);
    if (requireVerification && metadata.qaExclusionStatus !== "CONFIRMED_CLEAN") return observation(null, "NOT_AVAILABLE", "QA_CONTAMINATION_NOT_RESOLVED", context);
    return observation(value, "OBSERVED", null, context);
  }
  const affiliateClicks = gaMetric("affiliateClickEventCount", true);
  const sessions = gaMetric("sessions");
  const pageViews = gaMetric("screenPageViews");
  const ctr = affiliateClicks.value !== null && pageViews.value > 0 ? observation(affiliateClicks.value / pageViews.value * 100, "OBSERVED", null, { ...context, unit: "PERCENT", calculation: "affiliate_click eventCount / screenPageViews * 100" }) : observation(null, "NOT_CALCULABLE", "MISSING_INPUT_OR_ZERO_PAGEVIEWS", context);
  return {
    context, measurement,
    sessions, pageViews, affiliateClicks, affiliateCtr: ctr,
    // Preserve source data, with an explicit label: never present channel groups as UTM campaigns.
    byTrafficSource: { availability: sessions.availability, reason: sessions.reason, values: sessions.value === null ? null : page?.ga4?.byTrafficSource ?? null },
    affiliateClickByTrafficSource: { availability: affiliateClicks.availability, reason: affiliateClicks.reason, values: affiliateClicks.value === null ? null : page?.ga4?.affiliateClickByTrafficSource ?? null },
    trafficGrain: "SESSION_DEFAULT_CHANNEL_GROUP",
    searchConsole: page?.searchConsole ?? { status: "NOT_AVAILABLE" },
    urlInspection: page?.urlInspection ?? { status: "INDEX_STATUS_NOT_AVAILABLE" },
    gscCaveat: "GSC date/timezone follows its source. Legacy dataLastAvailableDate is a requested date, not proof of completeness. GSC clicks are not note LP clicks.",
    rawValuesPreservedInSource: true,
  };
}
