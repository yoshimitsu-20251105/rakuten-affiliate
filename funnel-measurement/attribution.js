import { canonicalLP } from "./model.js";

// A manually supplied mapping is not proof of a sale's click cohort. PR1's actual
// order report contains no stable click identifier: cohort attribution stays unknown.
export function epcCompatibility(batch, analytics, mapping, measurementId) {
  const no = (reason) => ({ compatible: false, reason });
  if (!batch || !analytics) return no("MISSING_RAKUTEN_OR_ANALYTICS");
  if (!measurementId || !mapping) return no("NO_EXCLUSIVE_MEASUREMENT_ID_MAPPING");
  if (mapping.accountScopeId !== batch.accountScopeId || mapping.measurementId !== measurementId || mapping.exclusiveToLP !== true || !mapping.evidenceReference) return no("MAPPING_NOT_PROVEN_EXCLUSIVE");
  if (canonicalLP(mapping.targetLP) !== analytics.context.targetLP) return no("LP_SCOPE_MISMATCH");
  const period = analytics.context.period;
  if (mapping.validFrom > period.start || mapping.validThrough < period.end || !mapping.validFrom || !mapping.validThrough) return no("MAPPING_PERIOD_MISMATCH");
  if (batch.periodStart !== period.start || batch.periodEnd !== period.end || batch.observedThrough !== period.end) return no("PERIOD_MISMATCH");
  if (batch.timezone !== analytics.context.timezone) return no("TIMEZONE_MISMATCH");
  // Do not accidentally call occurrence-month earnings / visit-month clicks a verified EPC.
  return no("CLICK_COHORT_LINK_NOT_AVAILABLE_IN_ORDER_CSV");
}
