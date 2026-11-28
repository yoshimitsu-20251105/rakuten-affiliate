import { collectGoogleRows } from "./google-live.js";

const SITE = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";

export async function collectDailyGoogleRows({ clients, targetUrl, startDate, endDate }) {
  const scope = { clients, targetUrl, startDate, endDate };
  const result = await collectGoogleRows(scope);
  if (!result.ok) return result;
  const { data } = await clients.searchconsole.searchanalytics.query({
    siteUrl: SITE,
    requestBody: {
      startDate, endDate, type: "web", dataState: "all", dimensions: ["date"], rowLimit: 1,
      dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: targetUrl }] }],
    },
  });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_GSC_FRESHNESS_RESPONSE");
  // Use metadata only; provisional rows never enter the ledger.
  return { ...result, gscFirstIncompleteDate: data.metadata?.firstIncompleteDate ?? null };
}
