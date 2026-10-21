import { canonical, hash } from "./model.js";
import { PERFORMANCE_METRICS, POLICY_HASH } from "./policy.js";

const present = (value) => value !== null && value !== undefined && value !== "" && value !== "UNKNOWN";

function rankGroups(rows, groupField, valueFor, rankField, reasonsField) {
  const groups = new Map();
  for (const row of rows) if (row[groupField]) {
    if (!groups.has(row[groupField])) groups.set(row[groupField], []);
    groups.get(row[groupField]).push(row);
  }
  for (const group of groups.values()) {
    if (group.length < 2) { group[0][reasonsField].push("INSUFFICIENT_COMPARABLE_PEERS"); continue; }
    const values = new Map(group.map((row) => [row, valueFor(row, group)]));
    group.sort((a, b) => {
      const x = values.get(a), y = values.get(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? -1 : 1;
      return (a.assessmentId ?? a.candidateId).localeCompare(b.assessmentId ?? b.candidateId);
    });
    let last = null, rank = null;
    for (const [index, row] of group.entries()) {
      const tuple = canonical(values.get(row));
      if (tuple !== last) rank = index + 1;
      row[rankField] = rank; last = tuple;
    }
  }
}

/** Recorded totals only; there is no exploration input to this comparator. */
export function compareObservedPerformance(rows) {
  const required = ["observedThrough", "snapshotAsOf", "currency", "timezone", "dateBasis", "coverage", "grain", "accountScopeId", "periodStatus", "final", "country", "language"];
  for (const row of rows) {
    row.comparisonGroup = null; row.performanceRank = null; row.comparisonDepth = []; row.comparisonReasons = [];
    const metric = row.metrics.approvedRevenue, context = metric.context;
    if (metric.value === null || metric.evidenceType !== "FACT") row.comparisonReasons.push("APPROVED_REVENUE_NOT_COMPARABLE");
    else if (!context || required.some((key) => !present(context[key])) || !present(context.period?.start) || !present(context.period?.end)) row.comparisonReasons.push("PERFORMANCE_COMPARISON_CONTEXT_UNKNOWN");
    else row.comparisonGroup = hash({ view: "observed", context });
  }
  rankGroups(rows, "comparisonGroup", (row, peers) => {
    const prefix = [];
    for (const key of PERFORMANCE_METRICS) {
      if (!peers.every((peer) => peer.metrics[key].value !== null && peer.metrics[key].evidenceType === "FACT" && canonical(peer.metrics[key].context) === canonical(row.metrics.approvedRevenue.context))) break;
      prefix.push(key);
    }
    row.comparisonDepth = prefix;
    if (prefix.length < PERFORMANCE_METRICS.length) row.comparisonReasons.push(`COMPARISON_STOPS_BEFORE_${PERFORMANCE_METRICS[prefix.length]}`);
    return prefix.map((key) => row.metrics[key].value);
  }, "performanceRank", "comparisonReasons");
  return rows;
}

/** Hypothesis scores only; no financial value is consulted or used as tie-break. */
export function compareExploration(rows, index) {
  for (const row of rows) {
    row.comparisonGroup = null; row.explorationRank = null; row.comparisonReasons = [];
    if (row.exploration.totalScore === null) { row.comparisonReasons.push("INCOMPLETE_EXPLORATION"); continue; }
    if (row.isSynthetic) { row.comparisonReasons.push("SYNTHETIC_EXCLUDED_FROM_REAL_RANKING"); continue; }
    if (!present(row.scope) || !present(row.country) || !present(row.language)) { row.comparisonReasons.push("EXPLORATION_COMPARISON_CONTEXT_UNKNOWN"); continue; }
    const scopes = row.components.demand.evidenceRefs.map((id) => {
      const e = index.evidence.get(id);
      return { sourceType: index.inputs.get(e.sourceId).sourceType, provider: e.provider, metric: e.metricOrClaim, unit: e.unit,
        country: e.country, language: e.language, timezone: e.timezone, grain: e.grain, periodStart: e.periodStart, periodEnd: e.periodEnd,
        sourceScope: e.scope?.sourceScope ?? e.scope, freshnessPolicy: row.components.demand.freshness.observations.find((v) => v.evidenceId === id)?.policy ?? null };
    });
    if (!scopes.length || scopes.some((s) => ["sourceType", "provider", "metric", "unit", "country", "language", "timezone", "grain", "periodStart", "periodEnd", "sourceScope"].some((key) => !present(s[key])) || s.country !== row.country || s.language !== row.language)) {
      row.comparisonReasons.push("DEMAND_COMPARISON_CONTEXT_UNKNOWN"); continue;
    }
    const distinct = [...new Map(scopes.map((s) => [hash(s), s])).values()];
    if (distinct.length !== 1) { row.comparisonReasons.push("MIXED_DEMAND_SCOPES_NOT_COMPARED"); continue; }
    row.comparisonGroup = hash({ view: "exploration", policyHash: POLICY_HASH, asOf: row.asOf,
      country: row.country, language: row.language, scope: row.scope, purpose: row.purpose, channel: row.channel, demand: distinct[0] });
  }
  rankGroups(rows, "comparisonGroup", (row) => [row.exploration.totalScore], "explorationRank", "comparisonReasons");
  return rows;
}
