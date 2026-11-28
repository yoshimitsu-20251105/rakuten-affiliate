const DAY_MS = 86_400_000;
const COUNTS = ["impressions", "clicks", "organicEngagedSessions", "affiliateClicks", "conversions", "approvedRevenueJpy"];
const QA_DATES = ["2026-11-27"];
const METRICS = [...COUNTS, "averagePosition"];
const TARGET_ROOT = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";

function day(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Expected ISO date");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || iso(timestamp) !== value) throw new Error("Invalid calendar date");
  return timestamp;
}
const iso = (timestamp) => new Date(timestamp).toISOString().slice(0, 10);
const unknowns = () => Object.fromEntries([...COUNTS, "ctr", "averagePosition"].map((key) => [key, null]));

function summarize(rows, start, end, finalThrough) {
  const window = { start: iso(start), end: iso(end) };
  const expected = [];
  const excluded = [];
  for (let date = start; date <= end; date += DAY_MS) {
    const label = iso(date);
    (QA_DATES.includes(label) ? excluded : expected).push(label);
  }
  const missingByMetric = {};
  const totals = unknowns();
  const awaitingFinalDataByMetric = {};
  for (const key of METRICS) {
    const awaiting = expected.filter((date) => finalThrough[key] != null && date > finalThrough[key]);
    awaitingFinalDataByMetric[key] = awaiting;
    const missing = expected.filter((date) => awaiting.includes(date) || (rows.get(date)?.[key] == null &&
      !(key === "averagePosition" && rows.get(date)?.impressions === 0)));
    missingByMetric[key] = missing;
    if (expected.length && !missing.length && key !== "averagePosition") {
      totals[key] = expected.reduce((sum, date) => sum + rows.get(date)[key], 0);
    }
  }
  if (totals.impressions > 0 && totals.clicks !== null) totals.ctr = totals.clicks / totals.impressions;
  if (totals.impressions > 0 && !missingByMetric.averagePosition.length) {
    totals.averagePosition = expected.reduce((sum, date) => {
      const row = rows.get(date);
      return sum + row.impressions * (row.averagePosition ?? 0);
    }, 0) / totals.impressions;
  }
  return { window, eligibleDays: expected.length, excluded, missingByMetric, awaitingFinalDataByMetric, totals };
}

export function buildExperimentReport(input) {
  const { experimentId, targetUrl, startDate, endDate, day0, asOf, baseline, rows, finalThrough = {} } = input;
  if (typeof experimentId !== "string" || !/^[a-z0-9-]{1,120}$/.test(experimentId)) throw new Error("Invalid experiment ID");
  if (typeof targetUrl !== "string" || !targetUrl.startsWith(TARGET_ROOT) ||
      !/^[a-zA-Z0-9_/-]+\.html$/.test(targetUrl.slice(TARGET_ROOT.length))) throw new Error("Invalid target URL");
  const start = day(startDate), end = day(endDate), today = day(asOf);
  const kickoff = day0 === null ? null : day(day0);
  if (start > end || end >= today || end - start > 365 * DAY_MS || (kickoff !== null && (kickoff > start || end - kickoff > 365 * DAY_MS))) {
    throw new Error("Invalid measurement window");
  }
  for (const [key, cutoff] of Object.entries(finalThrough)) {
    if (!METRICS.includes(key) || day(cutoff) >= today) throw new Error("Invalid final data cutoff");
  }
  if (!Array.isArray(rows)) throw new Error("Expected daily rows");
  const indexed = new Map();
  for (const row of rows) {
    const date = day(row.date);
    if (date < start || date > end || indexed.has(row.date)) throw new Error("Out-of-window or duplicate daily row");
    for (const key of COUNTS) {
      if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) throw new Error(`Invalid ${key}`);
    }
    if (row.averagePosition != null && (!Number.isFinite(row.averagePosition) || row.averagePosition < 1)) throw new Error("Invalid average position");
    if (row.clicks > row.impressions && row.impressions != null) throw new Error("Clicks exceed impressions");
    indexed.set(row.date, row);
  }
  let baselineComparison = null;
  const cumulative = kickoff === null ? null : summarize(indexed, kickoff, end, finalThrough);
  if (baseline != null) {
    const baselineStart = day(baseline.startDate), baselineEnd = day(baseline.endDate);
    if (baselineStart > baselineEnd || baselineEnd >= start ||
        !Number.isSafeInteger(baseline.impressions) || baseline.impressions < 0 ||
        !Number.isSafeInteger(baseline.clicks) || baseline.clicks < 0 || baseline.clicks > baseline.impressions) {
      throw new Error("Invalid baseline");
    }
    const baselineDays = (baselineEnd - baselineStart) / DAY_MS + 1;
    const deltas = Object.fromEntries(["impressions", "clicks"].map((key) => [
      key, cumulative?.totals[key] == null ? null : cumulative.totals[key] / cumulative.eligibleDays - baseline[key] / baselineDays,
    ]));
    baselineComparison = { baseline, perDayDelta: deltas };
  }
  return {
    experimentId, targetUrl, day0, asOf, finalThrough, dataOrigin: "USER_SUPPLIED", unknownRepresentation: null,
    checkpoints: kickoff === null ? null : Object.fromEntries([7, 14, 28].map((offset) => [
      `day${offset}`, iso(kickoff + offset * DAY_MS),
    ])),
    yesterday: summarize(indexed, today - DAY_MS, today - DAY_MS, finalThrough),
    lastSevenDays: summarize(indexed, today - 7 * DAY_MS, today - DAY_MS, finalThrough),
    requested: summarize(indexed, start, end, finalThrough),
    cumulative, baselineComparison,
    decision: "HOLD",
    recommendation: "Confirm source coverage and page-level attribution before evaluating the experiment.",
  };
}
