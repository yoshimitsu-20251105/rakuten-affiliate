import { parseRakutenOrder } from "../funnel-measurement/rakuten-order.js";
import { aggregateRevenue } from "../funnel-measurement/metrics.js";
import { buildExperimentReport } from "./report.js";

const DAY = 86_400_000;
const REFRESH_DAYS = 7;
const GA4_LAG_DAYS = 3;
const maxDate = (a, b) => a > b ? a : b;
const minDate = (a, b) => a < b ? a : b;

function time(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DAILY_DATE");
  const value = Date.parse(date);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error("INVALID_DAILY_DATE");
  return value;
}

const shift = (date, days) => new Date(time(date) + days * DAY).toISOString().slice(0, 10);

export function closedDateBoundary(now, ga4Timezone) {
  if (typeof ga4Timezone !== "string" || !ga4Timezone.length) throw new Error("GA4_TIMEZONE_REQUIRED");
  const date = (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  return minDate(date("America/Los_Angeles"), date(ga4Timezone));
}

export function rakutenSnapshot(input, config, now) {
  if (!input) return { status: "NOT_IMPORTED", metrics: null };
  const { csv, metadata } = input;
  if (typeof csv !== "string" || metadata?.isSynthetic !== false) throw new Error("INVALID_RAKUTEN_SOURCE");
  const snapshot = parseRakutenOrder(Buffer.from(csv, "utf8"), metadata, { importedAt: now.toISOString() });
  const mapping = config.rakuten;
  if (!mapping?.measurementId || mapping.exclusiveToLP !== true || !mapping.evidenceReference ||
      mapping.targetLP !== config.targetUrl || mapping.accountScopeId !== snapshot.batch.accountScopeId ||
      time(mapping.validFrom) > time(snapshot.batch.periodStart) ||
      time(mapping.validThrough) < time(snapshot.batch.observedThrough) ||
      time(config.day0) > time(snapshot.batch.periodStart)) {
    return { status: "UNATTRIBUTABLE", metrics: null };
  }
  return {
    status: "OCCURRENCE_SNAPSHOT",
    metrics: aggregateRevenue(snapshot, { measurementId: mapping.measurementId }),
  };
}

export async function runDailyMeasurement({ config, now, storage, collect }) {
  const { experimentId, targetUrl, day0, baseline } = config;
  if (!/^[a-z0-9-]{1,120}$/.test(experimentId ?? "") || config.approved !== true) {
    throw new Error("APPROVED_EXPERIMENT_REQUIRED");
  }
  time(day0);
  const asOf = closedDateBoundary(now, config.ga4Timezone);
  const endDate = shift(asOf, -1);
  if (day0 > endDate) return "AWAITING_COMPLETE_DAY";
  const reportFor = (startDate, end, rows, finalThrough) => buildExperimentReport({
    experimentId, targetUrl, startDate, endDate: end, day0, asOf, baseline, rows, finalThrough,
  });
  reportFor(day0, endDate, [], {});
  const prefix = `daily/${experimentId}/`;
  const key = `${prefix}${asOf}.json`;
  const current = await storage.read(key);
  const prior = current ?? await storage.latest(prefix, asOf);
  if (prior) {
    if (prior.experimentId !== experimentId || prior.targetUrl !== targetUrl || prior.day0 !== day0 ||
        (current ? prior.asOf !== asOf : prior.asOf >= asOf) || !Array.isArray(prior.rows)) {
      throw new Error("PRIVATE_SNAPSHOT_SCOPE_MISMATCH");
    }
    if (current) return "ALREADY_EXISTS";
    reportFor(day0, shift(prior.asOf, -1), prior.rows, {});
  }
  const startDate = prior ? maxDate(day0, minDate(prior.asOf, shift(asOf, -REFRESH_DAYS))) : day0;
  const observed = await collect({ targetUrl, startDate, endDate });
  if (!observed.ok) throw new Error("DAILY_GOOGLE_COLLECTION_FAILED");
  reportFor(startDate, endDate, observed.rows, {});
  const rows = [...(prior?.rows ?? []).filter((row) => row.date < startDate), ...observed.rows]
    .sort((a, b) => a.date.localeCompare(b.date));
  const gaCutoff = shift(asOf, -GA4_LAG_DAYS - 1);
  const finalThrough = { organicEngagedSessions: gaCutoff, affiliateClicks: gaCutoff };
  const firstIncomplete = observed.gscFirstIncompleteDate ?? null;
  if (firstIncomplete !== null) {
    time(firstIncomplete);
    if (firstIncomplete < startDate || firstIncomplete > endDate) throw new Error("INVALID_GSC_FRESHNESS_DATE");
    for (const key of ["impressions", "clicks", "averagePosition"]) finalThrough[key] = shift(firstIncomplete, -1);
  }
  const full = reportFor(day0, endDate, rows, finalThrough);
  const window = (first, last) => first < day0 || last > endDate ? null :
    reportFor(first, last, rows.filter((row) => row.date >= first && row.date <= last), finalThrough).requested;
  const rolling = Object.fromEntries([7, 28].map((size) => {
    const current = window(shift(asOf, -size), endDate);
    const previous = window(shift(asOf, -2 * size), shift(asOf, -size - 1));
    const delta = Object.fromEntries(Object.keys(full.requested.totals).map((key) => [key,
      current?.totals[key] == null || previous?.totals[key] == null ? null : current.totals[key] - previous.totals[key],
    ]));
    return [size, { current, previous, delta }];
  }));
  const checkpoints = Object.fromEntries([7, 14, 28].map((size) => {
    const evaluableThrough = shift(day0, size);
    const observed = window(day0, evaluableThrough);
    return [size, { through: evaluableThrough, observed, decision: "HOLD" }];
  }));
  let orderInput = null;
  if (config.rakuten?.reportMonth !== undefined) {
    const month = config.rakuten.reportMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("INVALID_RAKUTEN_MONTH");
    orderInput = await storage.read(`rakuten/${month}.json`);
    if (orderInput && orderInput.metadata?.reportLabel !== month.replace("-", ".")) throw new Error("RAKUTEN_PERIOD_MISMATCH");
  }
  const rakuten = rakutenSnapshot(orderInput, config, now);
  return storage.create(key, {
    experimentId, targetUrl, day0, asOf, rows, sources: observed.status,
    dateBasis: { gsc: "America/Los_Angeles", ga4: config.ga4Timezone, rakuten: "Asia/Tokyo" },
    gscFirstIncompleteDate: firstIncomplete,
    ga4Freshness: { cutoff: gaCutoff, meaning: "OPERATIONAL_LAG_POLICY_NOT_PROVIDER_FINALITY" },
    report: full, rolling, checkpoints, rakuten,
  });
}
