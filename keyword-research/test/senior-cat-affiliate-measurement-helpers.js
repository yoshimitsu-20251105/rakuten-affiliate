import { SENIOR_CAT_TRACKING_TAG } from "../../lib/senior-cat-affiliate-measurement.js";

export const LEGACY_TRACKER = /<script>\(function\(\)\{\n  var ctas = document\.querySelectorAll\('\.cta-button\[data-page-type\]'\);[\s\S]*?\}\)\(\);<\/script>/g;
export const GA_LOADER = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-5FQMHQ5X6W"></script>';

// Only this script replacement is authorized. Text, CTA labels, hrefs, GA4
// configuration, and all other bytes must still match the protected baseline.
export function permittedSeniorCatTrackingUpdate(before, after) {
  if ([...before.matchAll(LEGACY_TRACKER)].length !== 1 || before.split(GA_LOADER).length !== 2) return false;
  return after === before.replace(LEGACY_TRACKER, "").replace(GA_LOADER, `${SENIOR_CAT_TRACKING_TAG}\n${GA_LOADER}`);
}

export function permittedSeniorCatQaQueryUpdate(before, after) {
  const importLine = 'import { SITE_URL } from "../lib/site-config.js";';
  const filter = '{ filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: pagePath } } }';
  if (before.split(importLine).length !== 2 || before.split(filter).length !== 5) return false;
  return after === before.replace(importLine, `${importLine}\nimport { SENIOR_CAT_PATH, seniorCatBusinessPageFilter } from "../lib/senior-cat-affiliate-measurement.js";`)
    .replaceAll(filter, "seniorCatBusinessPageFilter(pagePath)")
    .replace('    const pagePath = pagePathFromUrl(pageUrl);', '    const pagePath = pagePathFromUrl(pageUrl);\n    const missingValue = pagePath === SENIOR_CAT_PATH ? null : 0;')
    .replace(': [0, 0, 0, 0, 0];', ': [missingValue, missingValue, missingValue, missingValue, missingValue];')
    .replace('const affiliateClickEventCount = eventRow ? Number(eventRow.metricValues[0].value) : 0;', 'const affiliateClickEventCount = eventRow ? Number(eventRow.metricValues[0].value) : missingValue;')
    .replace('      affiliateClickByTrafficSource,', `      affiliateClickByTrafficSource,
      ...(pagePath === SENIOR_CAT_PATH ? {
        pageRowsStatus: row ? "OBSERVED" : "NO_ROWS_RETURNED",
        affiliateClickRowsStatus: eventRow ? "OBSERVED" : "NO_ROWS_RETURNED",
        qaExclusion: { method: "QUERY_FILTER", parameter: "amv2_qa=1", scope: "EXACT_LP" },
      } : {}),`);
}

export function permittedNullObservationUpdate(path, before, after) {
  if (path === "keyword-research/search-trial-judgment.js") {
    const fields = ["screenPageViews", "affiliateClickEventCount"];
    let expected = before;
    for (const field of fields) {
      const old = `ga4?.status === "OK" ? ga4.${field} ?? 0 : undefined`;
      if (expected.split(old).length !== 2) return false;
      expected = expected.replace(old, `ga4?.status === "OK" && typeof ga4.${field} === "number" ? ga4.${field} : undefined`);
    }
    return after === expected;
  }
  const patches = {
    "funnel-measurement/analytics-report-input.js": ['    const value = page.ga4[field];', '    if (value === null) return observation(null, "NO_ROWS_RETURNED", "NO_ROWS_IS_NOT_ZERO", context);'],
    "keyword-research/search-trial-report-build.js": ['  if (ga4.status !== "OK") return "NOT_AVAILABLE";', '  if (typeof ga4.affiliateClickEventCount !== "number" || typeof ga4.screenPageViews !== "number") return "NOT_AVAILABLE";'],
  };
  const patch = patches[path];
  return Boolean(patch && before.split(patch[0]).length === 2 && after === before.replace(patch[0], `${patch[0]}\n${patch[1]}`));
}
