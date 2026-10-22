import { scopeCovers } from "../learning-engine/model.js";
import { freshness } from "../market-scanner/model.js";
import { canonical, evidenceRef } from "./model.js";
import { classifyRegistry, concurrency, evaluateProposal } from "./gates.js";
import { PERFORMANCE_METRICS } from "../opportunity-scorer/policy.js";

const inScope = (p, s) => (!s.candidateIds.length || s.candidateIds.includes(p.candidateId)) && (!s.channel || s.channel === p.channel) && (!s.purpose || s.purpose === p.purpose);
export function comparisonValue(input, proposal) {
  const { selectionTrack, maxSnapshotAgeDays } = input.selectionContext.policy;
  const scorer = input.scorerReport, assessment = scorer.assessments.find((r) => r.assessmentId === proposal.assessmentId);
  if ((Date.parse(input.asOf) - Date.parse(scorer.asOf)) / 86400000 > maxSnapshotAgeDays) return { reason: "SCORER_SNAPSHOT_STALE", group: null };
  if (selectionTrack === "EXPLORATION") {
    if (assessment.exploration.totalScore === null || !assessment.comparisonGroup) return { reason: "EXPLORATION_UNKNOWN_OR_INCOMPARABLE", group: null };
    for (const component of Object.values(assessment.components)) {
      const period = component.period.applicablePeriod;
      if (period && (period.start > input.asOf.slice(0, 10) || period.end < input.asOf.slice(0, 10))) return { reason: "ASSESSMENT_PERIOD_EXPIRED", group: null };
      for (const id of component.evidenceRefs) {
        const e = input.index.evidence.get(id), f = freshness({ retrievedAt: e.retrievedAt, periodEnd: e.periodEnd }, input.asOf, input.scannerReport.policy?.[e.sourceId] ?? {});
        if (["STALE", "AFTER_AS_OF"].includes(f.status) || component === assessment.components.demand && f.status !== "WITHIN_POLICY") return { reason: "EVIDENCE_NO_LONGER_FRESH", group: null };
      }
    }
    return { group: assessment.comparisonGroup, value: assessment.exploration.totalScore, evidenceType: "HYPOTHESIS", reason: null };
  }
  const performance = scorer.observedPerformance.find((r) => r.candidateId === proposal.candidateId), metric = performance.metrics.approvedRevenue;
  const reference = proposal.referencePerformanceScope, source = metric.sourceObservation.scope;
  if (!performance.comparisonGroup || !reference?.accountScopeId || !reference.measurementId || !source || !scopeCovers(source, reference))
    return { group: null, reason: "OBSERVED_FACT_OR_REFERENCE_SCOPE_NOT_COMPARABLE" };
  if (!metric.sourceObservation.snapshotAsOf || (Date.parse(input.asOf) - Date.parse(metric.sourceObservation.snapshotAsOf)) / 86400000 > maxSnapshotAgeDays)
    return { group: null, reason: "FUNNEL_SNAPSHOT_STALE", value: null };
  return { group: performance.comparisonGroup, metrics: performance.metrics, referencePerformanceScope: reference,
    evidenceType: "FACT", attribution: "RECORDED_CANDIDATE_SCOPE_ONLY_NOT_PROPOSED_CHANNEL_ATTRIBUTION", reason: null };
}

/** Compare one explicitly declared track; never consult the other track to break ties. */
export function select(input) {
  const { policy, proposals } = input.selectionContext, classified = classifyRegistry(input);
  const rows = proposals.map((p) => evaluateProposal(input, p, classified));
  for (const row of rows) {
    const p = proposals.find((p) => p.proposalId === row.proposalId);
    if (!inScope(p, policy.selectionScope)) { row.eligibility = "OUT_OF_SCOPE"; row.rejectionReason.push("OUTSIDE_PREDECLARED_SELECTION_SCOPE"); }
    row.comparison = comparisonValue(input, p);
    if (policy.selectionTrack === "OBSERVED_PERFORMANCE") {
      const i = input.scorerReport.observedPerformance.findIndex((r) => r.candidateId === p.candidateId);
      row.evidenceRefs.push(...PERFORMANCE_METRICS.map((key) => evidenceRef(input, "scorerReport", `/observedPerformance/${i}/metrics/${key}`,
        input.scorerReport.observedPerformance[i].metrics[key].evidenceType)));
    }
  }
  let ready = rows.filter((r) => r.eligibility === "ELIGIBLE"), reason = ready.length ? null : "NO_ELIGIBLE_PROPOSALS";
  if (ready.some((r) => !r.comparison.group)) reason = "COMPARISON_UNKNOWN_NO_SELECTION";
  else if (policy.comparisonGroup) {
    for (const r of ready.filter((r) => r.comparison.group !== policy.comparisonGroup)) { r.eligibility = "OUT_OF_SCOPE"; r.rejectionReason.push("OUTSIDE_PREDECLARED_COMPARISON_GROUP"); }
    ready = ready.filter((r) => r.comparison.group === policy.comparisonGroup);
    if (!ready.length) reason = "NO_ELIGIBLE_PROPOSALS_IN_DECLARED_GROUP";
  } else if (new Set(ready.map((r) => r.comparison.group)).size > 1) reason = "MULTIPLE_INCOMPARABLE_GROUPS_NO_SELECTION";
  let comparisonDepth = [];
  if (!reason && policy.selectionTrack === "OBSERVED_PERFORMANCE") {
    if (new Set(ready.map((r) => r.candidateId)).size !== ready.length) reason = "CANDIDATE_REVENUE_CANNOT_CHOOSE_BETWEEN_PROPOSED_CHANNELS";
    for (const key of PERFORMANCE_METRICS) {
      if (!ready.every((r) => r.comparison.metrics[key].value !== null && r.comparison.metrics[key].evidenceType === "FACT" &&
        canonical(r.comparison.metrics[key].context) === canonical(r.comparison.metrics.approvedRevenue.context))) break;
      comparisonDepth.push(key);
    }
    if (!comparisonDepth.length) reason = "NO_COMMON_FACT_COMPARISON_PREFIX";
  }
  let winner = null;
  if (!reason) {
    const tuple = (r) => policy.selectionTrack === "EXPLORATION" ? [r.comparison.value] : comparisonDepth.map((key) => r.comparison.metrics[key].value);
    const compare = (a, b) => { const x = tuple(a), y = tuple(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? -1 : 1; return 0; };
    const ordered = [...ready].sort(compare);
    if (ordered.length > 1 && compare(ordered[0], ordered[1]) === 0) reason = "TIED_BEST_NO_SELECTION";
    else { winner = ordered[0]; reason = ready.length === 1 ? "SOLE_COMPARABLE_ELIGIBLE_PROPOSAL" : "UNIQUE_BEST_WITHIN_DECLARED_TRACK_AND_GROUP"; }
  }
  for (const r of rows) {
    if (r === winner) { r.selected = true; r.selectionReason = reason; }
    else if (r.eligibility === "ELIGIBLE") r.rejectionReason.push(winner ? "NOT_BEST_IN_DECLARED_COMPARISON" : reason);
    if (r.comparison.reason) r.rejectionReason.push(r.comparison.reason);
    r.rejectionReason = [...new Set(r.rejectionReason)];
    if (r.selected) r.rejectionReason = [];
  }
  const candidates = input.scannerReport.candidates.map((c, i) => {
    const own = rows.filter((r) => r.candidateId === c.candidateId), picked = own.find((r) => r.selected);
    return { candidateId: c.candidateId, eligibility: picked ? "ELIGIBLE" : !own.length ? "MANUAL_REVIEW_REQUIRED" : own.some((r) => r.eligibility === "ELIGIBLE") ? "ELIGIBLE" : own[0].eligibility,
      selected: Boolean(picked), selectionReason: picked?.selectionReason ?? null,
      rejectionReason: picked ? [] : own.length ? [...new Set(own.flatMap((r) => r.rejectionReason))] : ["NO_EXPLICIT_PROPOSAL_DEFINED"],
      evidenceRefs: [evidenceRef(input, "scannerReport", `/candidates/${i}`), ...own.flatMap((r) => r.evidenceRefs)],
    retryStatus: picked?.retryStatus ?? (own.length && own.every((r) => r.retryStatus === own[0].retryStatus) ? own[0].retryStatus : "UNKNOWN"),
      measurementGateStatus: picked?.measurementGateStatus ?? (own.length && own.every((r) => r.measurementGateStatus === own[0].measurementGateStatus) ? own[0].measurementGateStatus : "NOT_VERIFIED"),
      concurrencyStatus: picked?.concurrencyStatus ?? (own.length && own.every((r) => r.concurrencyStatus === own[0].concurrencyStatus) ? own[0].concurrencyStatus : "UNKNOWN"),
      proposals: own, canStartExperiment: false };
  });
  return { candidates, proposals: rows, recommendations: winner ? [{ proposalId: winner.proposalId, candidateId: winner.candidateId, reason, evidenceRefs: winner.evidenceRefs,
    evidenceType: "HYPOTHESIS", canStartExperiment: false, requiresStartTimeRevalidation: true }] : [], selectionReason: reason, comparisonDepth,
    runningClassifications: classified.filter((e) => e.status === "RUNNING"),
    concurrency: policy.monetizationGroups.map((g) => concurrency(input, g, classified)) };
}
