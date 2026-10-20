import { observation, sumSafe } from "./model.js";

export function aggregateRevenue(snapshot, { measurementId = null } = {}) {
  if (!snapshot) return Object.fromEntries(["revenue", "approvedRevenue", "cancelledRevenue", "merchandiseSales", "conversions"].map((key) => [key, observation(null, "NOT_IMPORTED", "NO_RAKUTEN_SNAPSHOT")]));
  const { batch } = snapshot;
  const context = {
    currency: batch.currency, importId: batch.importId, provider: batch.provider,
    sourceReference: batch.sourceReference, retrievedAt: batch.retrievedAt, snapshotAsOf: batch.snapshotAsOf,
    period: { start: batch.periodStart, end: batch.periodEnd }, observedThrough: batch.observedThrough,
    dateBasis: batch.dateBasis, timezone: batch.timezone,
    grain: measurementId ? "MEASUREMENT_ID" : "ACCOUNT",
    scope: { accountScopeId: batch.accountScopeId, measurementId },
    periodStatus: batch.periodStatus, final: false, isSynthetic: batch.isSynthetic,
  };
  const records = measurementId === null ? snapshot.records : snapshot.records.filter((record) => record.measurementId === measurementId);
  const missingId = measurementId !== null && records.length === 0;
  const availability = batch.coverage === "COMPLETE" ? "OBSERVED" : "PARTIAL";
  const metric = (rows, field, unknownStatus = false) => {
    if (missingId) return observation(null, "UNATTRIBUTABLE", "MEASUREMENT_ID_NOT_IN_RECORDS", context);
    if (unknownStatus) return observation(null, "INCOMPLETE", "UNKNOWN_APPROVAL_STATUS", context);
    if (rows.some((row) => row[field] === null)) return observation(null, "NOT_AVAILABLE", "MISSING_AMOUNT", context);
    return observation(sumSafe(rows.map((row) => row[field])), availability, batch.coverage === "COMPLETE" ? null : "PARTIAL_SOURCE_COVERAGE", context);
  };
  const unknown = records.some((row) => row.approvalStatus === "UNKNOWN");
  const zeroConversions = !missingId && records.length === 0 && batch.coverage === "COMPLETE";
  const { currency, ...countContext } = context;
  return {
    revenue: metric(records.filter((row) => ["PENDING", "APPROVED"].includes(row.approvalStatus)), "commissionAmount", unknown),
    approvedRevenue: metric(records.filter((row) => row.approvalStatus === "APPROVED"), "commissionAmount", unknown),
    cancelledRevenue: metric(records.filter((row) => row.approvalStatus === "CANCELLED"), "commissionAmount", unknown),
    // All source rows, including cancelled rows; do not label this as net merchandise sales.
    merchandiseSales: metric(records, "merchandiseSalesAmount"),
    conversions: { ...observation(zeroConversions ? 0 : null, zeroConversions ? "OBSERVED" : missingId ? "UNATTRIBUTABLE" : "NOT_AVAILABLE", zeroConversions ? "ZERO_RECORD_SNAPSHOT_AS_OF" : "ROW_CONVERSION_GRAIN_UNVERIFIED", { ...countContext, unit: "COUNT" }), validationStatus: "PARTIALLY_VERIFIED" },
  };
}

export function calculateEpc(revenue, clicks, compatibility) {
  const context = { currency: revenue.currency ?? null, denominator: "GA4_OBSERVED_AFFILIATE_CLICK_EVENT_COUNT", calculation: "commission / affiliate_click eventCount", compatibility };
  if (revenue.availability !== "OBSERVED" || revenue.value === null || clicks.availability !== "OBSERVED" || clicks.value === null) return observation(null, "NOT_AVAILABLE", "MISSING_OR_PARTIAL_INPUT", context);
  if (!compatibility.compatible) return observation(null, "NOT_COMPARABLE", compatibility.reason, context);
  if (clicks.value <= 0) return observation(null, "NOT_CALCULABLE", "ZERO_AFFILIATE_CLICKS", context);
  return observation(revenue.value / clicks.value, "OBSERVED", null, context);
}
