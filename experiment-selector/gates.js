import { reviewProposal } from "../learning-engine/retry.js";
import { visibleAt } from "../learning-engine/model.js";
import { hash, canonicalLP, learningProposal, evidenceRef } from "./model.js";
import { LEGACY_OBJECTIVES, OBJECTIVE_FIELDS, objectiveHash, REVENUE_CLASSES, GROUP } from "./policy.js";

const age = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
const gate = (status, reason, extra = {}) => ({ status, reason, ...extra });
export function classifyRegistry(input) {
  const { experimentsSnapshot, selectionContext, asOf } = input;
  return experimentsSnapshot.items.map((e, i) => {
    const pinned = LEGACY_OBJECTIVES[e.experimentId], reviewed = selectionContext.experimentClassifications.find((r) => r.experimentId === e.experimentId);
    const exact = pinned && objectiveHash(e) === pinned[0] && !e.primaryMetric &&
      (!e.experimentClass || e.experimentClass === pinned[1]) && (!e.monetizationGroup || e.monetizationGroup === (REVENUE_CLASSES.includes(pinned[1]) ? GROUP : null));
    let experimentClass = exact ? pinned[1] : "UNKNOWN", monetizationGroup = REVENUE_CLASSES.includes(experimentClass) ? GROUP : null;
    let reason = exact ? "EXACT_DECLARED_OBJECTIVE_SIGNATURE" : "UNCLASSIFIED_OBJECTIVE_NO_INFERENCE";
    if (reviewed) {
      if (reviewed.recordHash !== hash(e) || Date.parse(reviewed.reviewedAt) > Date.parse(asOf) || !reviewed.evidencePointers.length ||
          pinned && (!exact || reviewed.experimentClass !== experimentClass || reviewed.monetizationGroup !== monetizationGroup)) {
        experimentClass = "UNKNOWN"; monetizationGroup = null; reason = "CLASSIFICATION_STALE_OR_CONFLICTING";
      } else { experimentClass = reviewed.experimentClass; monetizationGroup = reviewed.monetizationGroup; reason = "EXPLICIT_REVIEW_OF_DECLARED_OBJECTIVE"; }
    }
    return { experimentId: e.experimentId, status: e.status, experimentClass, monetizationGroup, reason, recordHash: hash(e),
      evidenceRefs: [evidenceRef(input, "experimentsSnapshot", `/items/${i}`), ...(exact ? OBJECTIVE_FIELDS.map((f) => evidenceRef(input, "experimentsSnapshot", `/items/${i}/${f}`)) : []),
        ...(reviewed ? [evidenceRef(input, "selectionContext", `/experimentClassifications/${selectionContext.experimentClassifications.indexOf(reviewed)}`)] : [])] };
  });
}
export function concurrency(input, group, classified = classifyRegistry(input)) {
  const { policy, registry } = input.selectionContext, active = classified.filter((e) => e.status === "RUNNING");
  const included = active.filter((e) => e.monetizationGroup === group), unknown = active.filter((e) => e.experimentClass === "UNKNOWN");
  const excluded = active.filter((e) => e.experimentClass !== "UNKNOWN" && e.monetizationGroup !== group);
  const base = { monetizationGroup: group, limit: policy.maxConcurrentMonetizationExperiments ?? null, runningCount: unknown.length ? null : included.length,
    knownRunningCount: included.length, included, excluded, unknown, countScope: "SAME_MONETIZATION_GROUP_ONLY", reservationCreated: false,
    evidenceRefs: [evidenceRef(input, "selectionContext", "/policy"), evidenceRef(input, "selectionContext", "/registry"), ...active.flatMap((e) => e.evidenceRefs)] };
  if (base.limit === null) return gate("UNKNOWN", "CONCURRENCY_LIMIT_NOT_CONFIGURED", base);
  if (!policy.monetizationGroups.includes(group)) return gate("UNKNOWN", "UNDECLARED_MONETIZATION_GROUP", base);
  if (registry.coverage !== "COMPLETE" || !registry.observedAt || registry.maxAgeDays == null || age(input.asOf, registry.observedAt) < 0 || age(input.asOf, registry.observedAt) > registry.maxAgeDays)
    return gate("UNKNOWN", "REGISTRY_COVERAGE_OR_FRESHNESS_UNKNOWN", base);
  if (Date.parse(policy.configuredAt) > Date.parse(input.asOf) || input.asOf.slice(0, 10) < policy.applicablePeriod.start || input.asOf.slice(0, 10) > policy.applicablePeriod.end)
    return gate("UNKNOWN", "POLICY_NOT_APPLICABLE_AS_OF", base);
  if (unknown.length) return gate("UNKNOWN", "RUNNING_CLASSIFICATION_UNKNOWN", base);
  return included.length + 1 <= base.limit ? gate("PASS", "CAPACITY_AVAILABLE_RECHECK_BEFORE_START", base) : gate("DEFERRED", "MONETIZATION_GROUP_LIMIT_REACHED", base);
}

export function assessRetry(review) {
  const matches = review.matches.filter((m) => m.revisionState !== "RETRACTED" && m.reviewStatus !== "RETRACTED" &&
    !(m.kind === "LEARNING" && m.reviewStatus === "PROPOSED" && m.revisionState !== "CONFLICT"));
  const learnings = matches.filter((m) => m.kind === "LEARNING");
  const required = learnings.flatMap((m) => m.conditions ?? []).filter((c) => c.required);
  if (required.some((c) => c.status === "NOT_SATISFIED")) return gate("NOT_SATISFIED", "REQUIRED_RETRY_CONDITION_NOT_SATISFIED");
  if (matches.some((m) => m.match !== "EXACT_SCOPE" || m.revisionState === "CONFLICT")) return gate("UNKNOWN", "HISTORY_SCOPE_OR_REVISION_REVIEW_REQUIRED");
  const constrained = matches.some((m) => m.kind === "EXPERIMENT_RESULT" && ["FAILED", "INCONCLUSIVE"].includes(m.status) ||
    m.kind === "RECORDED_DECISION" && ["KILL", "HOLD"].includes(m.decision));
  if (learnings.some((m) => m.retryStatus !== "SATISFIED")) return gate("UNKNOWN", "RETRY_CONDITIONS_OR_REVISIT_EVIDENCE_UNKNOWN");
  if (matches.some((m) => m.kind === "RECORDED_DECISION" && ["KILL", "HOLD"].includes(m.decision) && m.retryPolicy?.mode !== "CONDITIONAL"))
    return gate("UNKNOWN", "RECORDED_KILL_OR_HOLD_REQUIRES_EXPLICIT_RETRY_POLICY");
  if (constrained && !learnings.length) return gate("UNKNOWN", "STRUCTURED_RETRY_REVIEW_REQUIRED_NOT_AUTOMATIC_FAILURE_EXCLUSION");
  return constrained || learnings.length ? gate("SATISFIED", "APPLICABLE_RETRY_CONDITIONS_SATISFIED_NOT_START_PERMISSION", { required: true }) :
    gate("UNKNOWN", "NO_RETRY_REQUIRED_BY_APPLICABLE_HISTORY", { required: false });
}
export function collectCounterEvidence(input, p, review) {
  const c = input.index.candidates.get(p.candidateId), records = input.learningLedger;
  const items = c.counterEvidence.map((value, i) => ({ hash: hash(value), value,
    evidenceRefs: [evidenceRef(input, "scannerReport", `/candidates/${input.scannerReport.candidates.indexOf(c)}/counterEvidence/${i}`)] }));
  for (const m of review.matches) for (const collection of ["decisions", "learnings"]) {
    const r = records[collection].find((r) => r.recordId === m.recordId);
    if (!r || !visibleAt(records, r, input.asOf) || m.revisionState === "RETRACTED" || r.reviewStatus === "RETRACTED") continue;
    for (const id of [...(r.counterEvidenceRefs ?? []), ...(r.falsification?.counterEvidenceRefs ?? [])]) {
      const value = records.evidence.find((e) => e.recordId === id);
      if (value) items.push({ hash: hash(value), value, evidenceRefs: [evidenceRef(input, "learningLedger", `/evidence/${records.evidence.indexOf(value)}`)] });
    }
  }
  return [...new Map(items.map((r) => [r.hash, r])).values()];
}
export function evaluateProposal(input, p, classified = classifyRegistry(input)) {
  const c = input.index.candidates.get(p.candidateId), i = input.selectionContext.proposals.indexOf(p);
  const review = reviewProposal(input.learningLedger, learningProposal(p, input.isSynthetic), { asOf: input.asOf, measurementContext: input.measurementContexts?.[p.proposalId] ?? null });
  const retry = assessRetry(review), count = concurrency(input, p.monetizationGroup, classified), counterEvidence = collectCounterEvidence(input, p, review);
  const acknowledged = !counterEvidence.length || p.historyReview && Date.parse(p.historyReview.reviewedAt) <= Date.parse(input.asOf) && counterEvidence.every((r) => p.historyReview.counterEvidenceHashes.includes(r.hash));
  const lp = c.availableLPs.find((l) => l.targetLP === p.targetLP);
  const conflicts = input.experimentsSnapshot.items.filter((e) => e.status === "RUNNING" &&
    ((e.targetUrls ?? []).some((url) => canonicalLP(url) === p.targetLP) || p.scope.measurementId && e.measurementId === p.scope.measurementId)).map((e) => e.experimentId);
  const reasons = [];
  if (count.status !== "PASS") reasons.push(count.reason);
  if (retry.required !== false && retry.status !== "SATISFIED") reasons.push(retry.reason);
  if (c.priorDecisions.some((d) => !review.matches.some((m) => m.kind === "RECORDED_DECISION" && m.logicalId === d.decisionId && m.match === "EXACT_SCOPE")))
    reasons.push("SCANNER_PRIOR_DECISION_REQUIRES_LINKED_HISTORY_REVIEW");
  if (review.matches.some((m) => m.kind === "EXPERIMENT_RESULT" && new Set(input.learningLedger.experimentSnapshots.filter((s) =>
    s.experimentId === m.experimentId && s.isSynthetic === input.isSynthetic && visibleAt(input.learningLedger, s, input.asOf)).map((s) => hash(s.raw))).size > 1))
    reasons.push("CONFLICTING_EXPERIMENT_SNAPSHOTS_REVIEW_REQUIRED");
  if (!acknowledged) reasons.push("COUNTER_EVIDENCE_REVIEW_REQUIRED");
  if (p.purpose === "AFFILIATE_NOTE_ACQUISITION" && review.measurement.affiliateClickMeasurementStatus !== "VERIFIED") reasons.push("AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET");
  if (lp?.repositoryPresence?.value !== true) reasons.push("EXISTING_LP_PRESENCE_NOT_PROVEN");
  if (lp?.liveAvailability?.value === false || c.existingOffers.some((o) => p.itemCodes.includes(o.itemCode) && o.currentAvailability?.value === false))
    reasons.push("DECLARED_LP_OR_OFFER_UNAVAILABLE");
  if (conflicts.length) reasons.push("RUNNING_LP_OR_MEASUREMENT_INTERFERENCE");
  return { proposalId: p.proposalId, candidateId: p.candidateId, proposal: structuredClone(p), eligibility: !reasons.length ? "ELIGIBLE" : count.status === "DEFERRED" || retry.status === "NOT_SATISFIED" || conflicts.length ? "DEFERRED" : "MANUAL_REVIEW_REQUIRED",
    selected: false, selectionReason: null, rejectionReason: reasons, evidenceRefs: [evidenceRef(input, "selectionContext", `/proposals/${i}`),
      evidenceRef(input, "scorerReport", `/assessments/${input.scorerReport.assessments.findIndex((a) => a.assessmentId === p.assessmentId)}`, "HYPOTHESIS"), ...count.evidenceRefs, ...counterEvidence.flatMap((r) => r.evidenceRefs),
      ...review.matches.flatMap((m) => ["experimentSnapshots", "decisions", "learnings"].flatMap((k) => { const idx = input.learningLedger[k].findIndex((r) => r.recordId === m.recordId); return idx < 0 ? [] : [evidenceRef(input, "learningLedger", `/${k}/${idx}`)]; }))],
    retryStatus: retry.status, retry, measurementGateStatus: review.measurement.affiliateClickMeasurementStatus,
    measurement: review.measurement, concurrencyStatus: count.status, concurrency: count, counterEvidence, historyReview: review,
    interferenceExperimentIds: conflicts, canStartExperiment: false, requiresStartTimeRevalidation: true };
}
