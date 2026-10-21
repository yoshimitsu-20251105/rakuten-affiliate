import { aggregateRevenue, calculateEpc } from "./metrics.js";
import { readAnalyticsObservation } from "./analytics-report-input.js";
import { epcCompatibility } from "./attribution.js";
import { observation, SCHEMA_VERSION } from "./model.js";

export function buildFunnelReport({ snapshot = null, analyticsReport = null, analyticsMetadata = null, targetLP = null, measurementRecord = null, currentPageHash = null, mapping = null, generatedAt = new Date().toISOString() } = {}) {
  const metrics = aggregateRevenue(snapshot);
  const ids = [...new Set((snapshot?.records ?? []).map((record) => record.measurementId).filter(Boolean))].sort();
  const byMeasurementId = ids.map((measurementId) => ({ measurementId, metrics: aggregateRevenue(snapshot, { measurementId }) }));
  const analytics = analyticsReport ? readAnalyticsObservation(analyticsReport, analyticsMetadata, { targetLP, measurementRecord, currentPageHash }) : null;
  const mappedId = mapping?.measurementId;
  const selected = byMeasurementId.find((entry) => entry.measurementId === mappedId);
  const compatibility = selected ? epcCompatibility(snapshot.batch, analytics, mapping, mappedId) : { compatible: false, reason: "MEASUREMENT_ID_NOT_IN_RECORDS" };
  const clicks = analytics?.affiliateClicks ?? observation(null, "NOT_AVAILABLE", "NO_ANALYTICS_REPORT");
  const epcRevenue = selected?.metrics.revenue ?? observation(null, "UNATTRIBUTABLE", "NO_ATTRIBUTABLE_REVENUE");
  return {
    schemaVersion: SCHEMA_VERSION, generatedAt, purpose: "AFFILIATE_FUNNEL_MEASUREMENT",
    sourceBatch: snapshot?.batch ?? null,
    metrics: { ...metrics, epc: calculateEpc(epcRevenue, clicks, compatibility), approvedEpc: calculateEpc(selected?.metrics.approvedRevenue ?? epcRevenue, clicks, compatibility) },
    byMeasurementId, analytics,
    attribution: {
      accountRevenueIsNotAutomaticallySiteRevenue: true,
      measurementIdRevenueRequiresObservedRecord: true,
      channelRevenue: observation(null, "UNATTRIBUTABLE", "NO_CHANNEL_ATTRIBUTION_PROOF"),
      experimentRevenue: observation(null, "UNATTRIBUTABLE", "NO_EXPERIMENT_ATTRIBUTION_PROOF"),
      epcCompatibility: compatibility,
    },
    limitations: [
      "Nonzero real Rakuten rows and conversion grain remain PARTIALLY_VERIFIED; synthetic tests do not establish live validation.",
      "Each report selects one account/month snapshot; no transaction or cancellation merging across CSVs.",
      "Period totals are snapshots, never final monthly revenue. Currency/timezone/coverage are explicitly supplied metadata.",
      "NOTE_NATIVE_MONETIZATION and existing experiments are not read or modified.",
    ],
  };
}

function display(metric) {
  if (metric.value === null) return `未取得/算出不可 (${metric.availability}: ${metric.reason})`;
  return `${metric.value}${metric.currency ? ` ${metric.currency}` : metric.unit === "PERCENT" ? "%" : ""} (${metric.availability}${metric.isSynthetic ? ", SYNTHETIC・実運用不可" : ""})`;
}

export function renderFunnelMarkdown(report) {
  const batch = report.sourceBatch;
  const lines = ["# Funnel Measurement v1 — private", "", `Generated: ${report.generatedAt}`];
  if (batch) lines.push(`Report: 注文別成果 ${batch.reportLabel}`, `Result: ${batch.resultType} (${batch.recordCount} records)`, `Snapshot as of: ${batch.snapshotAsOf}`, `Retrieved: ${batch.retrievedAt}`, `Period: ${batch.periodStart}..${batch.periodEnd} / ${batch.periodStatus}`, `Coverage: ${batch.coverage} / ${batch.grain}`, `Currency: ${batch.currency} / timezone: ${batch.timezone} / basis: ${batch.dateBasis}`, `Source: ${batch.sourceReference}`, `Raw SHA-256: ${batch.sourceFileHash}`, `Import: ${batch.importId}`, `Synthetic: ${batch.isSynthetic}`, "月次の最終値ではなく取得時点のsnapshotです。");
  if (batch?.unknownColumns.length) lines.push(`Unknown columns (集計へ不使用): ${batch.unknownColumns.join(", ")}`);
  lines.push("", "## Account snapshot (このサイト/チャネルへの帰属は未確定)", "");
  for (const [key, label] of Object.entries({ approvedRevenue: "Approved Revenue", revenue: "Revenue (PENDING + APPROVED rewards)", conversions: "Conversions (PARTIALLY_VERIFIED)", epc: "EPC", approvedEpc: "Approved EPC", cancelledRevenue: "Cancelled Revenue (別表示・二重減算なし)", merchandiseSales: "Merchandise Sales (amount・取消を含む原本行合計)" })) lines.push(`- ${label}: ${display(report.metrics[key])}`);
  lines.push("", "## Observed measurement IDs", "");
  for (const entry of report.byMeasurementId) lines.push(`- ${entry.measurementId}: Revenue ${display(entry.metrics.revenue)} / Approved ${display(entry.metrics.approvedRevenue)}`);
  if (!report.byMeasurementId.length) lines.push("- 原本recordにmeasurement_idの観測なし。ID別0円とは解釈しません。");
  if (report.analytics) {
    lines.push("", "## LP measurement", "", `- targetLP: ${report.analytics.context.targetLP}`, `- affiliateClickMeasurementStatus: ${report.analytics.measurement.status}`);
    for (const key of ["sessions", "pageViews", "affiliateClicks", "affiliateCtr"]) lines.push(`- ${key}: ${display(report.analytics[key])}`);
    lines.push(`- GSC (source values; not note traffic): ${JSON.stringify(report.analytics.searchConsole)}`, `- URL Inspection: ${JSON.stringify(report.analytics.urlInspection)}`, `- GSC caveat: ${report.analytics.gscCaveat}`);
  }
  lines.push("", "## Attribution / limitations", "", `- Channel Revenue: ${display(report.attribution.channelRevenue)}`, `- Experiment Revenue: ${display(report.attribution.experimentRevenue)}`, ...report.limitations.map((line) => `- ${line}`));
  return lines.join("\n") + "\n";
}
