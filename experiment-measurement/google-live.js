import { google } from "googleapis";
import { seniorCatBusinessPageFilter } from "../lib/senior-cat-affiliate-measurement.js";

const SITE = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";
const PROPERTY = "properties/550074703";

export function createWifClients(token) {
  if (typeof token !== "string" || !token.trim()) throw new Error("MISSING_ACCESS_TOKEN");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return {
    searchconsole: google.searchconsole({ version: "v1", auth }),
    analyticsdata: google.analyticsdata({ version: "v1beta", auth }),
  };
}

function exact(fieldName, value) {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } };
}

export class ResponseValidationError extends Error {}

function checkedGscPosition(position, impressions) {
  // GSC position is defined only when there is an impression.
  if (position == null || (position === 0 && impressions === 0)) return null;
  if (!Number.isFinite(position) || position < 1) throw new ResponseValidationError("INVALID_GSC_AVERAGE_POSITION");
  return position;
}

function checkedCount(value) {
  if ((typeof value !== "number" && typeof value !== "string") || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new ResponseValidationError("INVALID_COUNT");
  return Number(value);
}

function mergeRows(index, rows, metrics, from, to) {
  const seen = new Set();
  for (const [date, values] of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to || seen.has(date)) throw new ResponseValidationError("INVALID_DAILY_ROW");
    seen.add(date);
    const row = index.get(date) ?? { date };
    for (const [i, key] of metrics.entries()) row[key] = key === "averagePosition" ? values[i] : checkedCount(values[i]);
    index.set(date, row);
  }
}

function state(error) {
  if (error instanceof ResponseValidationError) return "INVALID_RESPONSE";
  const code = Number(error?.response?.status ?? error?.code);
  if (code === 401) return "UNAUTHENTICATED";
  if (code === 403) return "PERMISSION_DENIED";
  return "FETCH_FAILED";
}

export async function collectGoogleRows({ clients, targetUrl, startDate, endDate }) {
  const url = new URL(targetUrl);
  if (!targetUrl.startsWith(SITE) || url.search || url.hash) throw new ResponseValidationError("INVALID_TARGET");
  const page = seniorCatBusinessPageFilter(url.pathname);
  const range = { startDate, endDate };
  const gsc = async () => {
    const { data } = await clients.searchconsole.searchanalytics.query({
      siteUrl: SITE,
      requestBody: {
        ...range, type: "web", dataState: "final", dimensions: ["date"], rowLimit: 25000,
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: targetUrl }] }],
      },
    });
    if (!data || (data.rows !== undefined && !Array.isArray(data.rows))) throw new ResponseValidationError("INVALID_GSC_RESPONSE");
    return (data.rows ?? []).map((row) => {
      if (!Array.isArray(row?.keys) || row.keys.length !== 1 || typeof row.keys[0] !== "string") {
        throw new ResponseValidationError("INVALID_GSC_DATE_KEY");
      }
      const impressions = checkedCount(row.impressions);
      return [row.keys[0], [impressions, row.clicks, checkedGscPosition(row.position, impressions)]];
    });
  };
  const ga = async (metric, filter) => {
    const { data } = await clients.analyticsdata.properties.runReport({
      property: PROPERTY,
      requestBody: {
        dateRanges: [range], dimensions: [{ name: "date" }], metrics: [{ name: metric }],
        dimensionFilter: { andGroup: { expressions: [exact("hostName", url.hostname), page, filter] } }, limit: "1000",
      },
    });
    if (!data || (data.rows !== undefined && !Array.isArray(data.rows)) ||
        data.metadata?.subjectToThresholding || data.metadata?.dataLossFromOtherRow ||
        data.metadata?.samplingMetadatas?.length ||
        Number(data.rowCount ?? 0) > (data.rows?.length ?? 0)) throw new ResponseValidationError("INCOMPLETE_GA4_RESPONSE");
    return (data.rows ?? []).map((row) => {
      const date = row?.dimensionValues?.[0]?.value;
      if (!/^\d{8}$/.test(date)) throw new ResponseValidationError("INVALID_GA4_DATE");
      return [date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"), [row.metricValues?.[0]?.value]];
    });
  };

  const sources = await Promise.allSettled([
    gsc(),
    ga("engagedSessions", exact("sessionDefaultChannelGroup", "Organic Search")),
    ga("eventCount", exact("eventName", "affiliate_click")),
  ]);
  const sourceNames = ["gsc", "ga4Organic", "ga4Affiliate"];
  const status = Object.fromEntries(sources.map((result, i) => [
    sourceNames[i],
    result.status === "rejected" ? state(result.reason) : result.value.length ? "OBSERVED" : "NO_ROWS_RETURNED",
  ]));
  if (sources.some((result) => result.status === "rejected")) {
    const invalidResponseReasons = Object.fromEntries(sources.flatMap((result, i) =>
      result.status === "rejected" && result.reason instanceof ResponseValidationError
        ? [[sourceNames[i], result.reason.message]]
        : [],
    ));
    return {
      ok: false, status,
      ...(Object.keys(invalidResponseReasons).length ? { invalidResponseReasons } : {}),
    };
  }
  const index = new Map();
  const metrics = [["impressions", "clicks", "averagePosition"], ["organicEngagedSessions"], ["affiliateClicks"]];
  for (const [i, result] of sources.entries()) mergeRows(index, result.value, metrics[i], startDate, endDate);
  return { ok: true, status, rows: [...index.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}
