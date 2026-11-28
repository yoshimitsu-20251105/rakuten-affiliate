const PROPERTY = "properties/550074703";
const HOST = "yoshimitsu-20251105.github.io";
const PAGE = "/rakuten-affiliate/rankings/senior-cat-food.html";
const DAY = 86_400_000;

function exact(fieldName, value) {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } };
}

export async function collectGa4Diagnostics({ client, now, propertyTimezone, confirmedThrough }) {
  if (!propertyTimezone) throw new Error("GA4_TIMEZONE_REQUIRED");
  const propertyToday = new Intl.DateTimeFormat("en-CA", { timeZone: propertyTimezone }).format(now);
  const date = (days) => new Date(Date.parse(propertyToday) - days * DAY).toISOString().slice(0, 10);
  // The operator supplies the last verified date; the recent delay guard also applies.
  if (typeof confirmedThrough !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(confirmedThrough)) {
    throw new Error("GA4_CONFIRMED_THROUGH_REQUIRED");
  }
  const through = Date.parse(confirmedThrough);
  if (!Number.isFinite(through) || new Date(through).toISOString().slice(0, 10) !== confirmedThrough ||
      confirmedThrough > date(4)) throw new Error("GA4_CONFIRMED_THROUGH_NOT_MATURE");
  const range = { startDate: new Date(through - 27 * DAY).toISOString().slice(0, 10), endDate: confirmedThrough };
  const host = exact("hostName", HOST);
  const page = exact("pagePath", PAGE);
  const hostPage = [host, page];
  const specs = [
    ["propertyViews", "screenPageViews", [], []],
    ["hostViews", "screenPageViews", [host], []],
    ["pageViews", "screenPageViews", hostPage, []],
    ["pageOrganic", "engagedSessions", [...hostPage, exact("sessionDefaultChannelGroup", "Organic Search")], []],
    ["pageAffiliate", "eventCount", [...hostPage, exact("eventName", "affiliate_click")], []],
    ["pageBreakdown", "screenPageViews", [host], ["pagePath"]],
  ];
  const metrics = {};
  for (const [key, metric, filters, dimensions] of specs) {
    const { data } = await client.properties.runReport({
      property: PROPERTY,
      requestBody: {
        dateRanges: [range], metrics: [{ name: metric }], dimensions: dimensions.map((name) => ({ name })),
        ...(filters.length ? { dimensionFilter: { andGroup: { expressions: filters } } } : {}),
        limit: "1000",
      },
    });
    if (!data || (data.rows !== undefined && !Array.isArray(data.rows)) ||
        !data.metadata?.timeZone || data.metadata.timeZone !== propertyTimezone) throw new Error("INVALID_GA4_DIAGNOSTICS_RESPONSE");
    if (data.metadata.subjectToThresholding || data.metadata.dataLossFromOtherRow ||
        data.metadata.samplingMetadatas?.length || Number(data.rowCount ?? 0) > (data.rows?.length ?? 0)) {
      metrics[key] = { status: "INCOMPLETE", data: null };
      continue;
    }
    const rows = data.rows ?? [];
    if (!rows.length) {
      metrics[key] = { status: "NO_ROWS_RETURNED", data: null };
      continue;
    }
    const parsed = rows.map((row) => {
      const raw = row.metricValues?.[0]?.value;
      if (typeof raw !== "string" || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
        throw new Error("INVALID_GA4_DIAGNOSTICS_COUNT");
      }
      if (dimensions.length && typeof row.dimensionValues?.[0]?.value !== "string") {
        throw new Error("INVALID_GA4_DIAGNOSTICS_DIMENSION");
      }
      return dimensions.length ? { path: row.dimensionValues[0].value, views: Number(raw) } : Number(raw);
    });
    if (!dimensions.length && parsed.length !== 1) throw new Error("UNEXPECTED_GA4_DIAGNOSTICS_ROWS");
    metrics[key] = { status: "OBSERVED", data: dimensions.length ? parsed : parsed[0] };
  }
  return { property: PROPERTY, range, propertyTimezone, finality: "OPERATOR_CONFIRMED_THROUGH_WITH_LAG_GUARD", metrics };
}
