import { measurementAvailability } from "../funnel-measurement/measurement-status.js";
import { assert, canonical, scope, scopeCovers, visibleAt, RETRY_STATES, validateProposal, validateCondition, timestamp, text, purposeCompatible } from "./model.js";
import { activeRevisions } from "./learning.js";

export function matchScope(previous, proposed, relatedExperimentIds = []) {
  const a = scope(previous), b = scope(proposed);
  const anchors = ["targetLP", "theme", "measurementId"].some((k) => a[k] != null && b[k] != null && a[k] === b[k]) ||
    ["experimentIds", "candidateIds", "opportunityIds", "itemCodes"].some((k) => a[k]?.some((v) => b[k]?.includes(v))) ||
    a.experimentIds?.some((id) => relatedExperimentIds.includes(id));
  if (!anchors) return "NO_MATCH";
  const context = { ...b, experimentIds: b.experimentIds ?? (a.experimentIds?.every((id) => relatedExperimentIds.includes(id)) ? a.experimentIds : null) };
  return scopeCovers(context, a) ? "EXACT_SCOPE" : "POSSIBLE_MATCH";
}
export function measurementForProposal(ledger, p, { asOf, measurementContext = null } = {}) {
  const context = p.measurement;
  const proof = ledger.evidence.find((e) => e.recordId === context?.evidenceRef && e.metricOrClaim === "lp_measurement" &&
    e.isSynthetic === p.isSynthetic && visibleAt(ledger, e, asOf));
  if (!proof || !p.scope.targetLP || !measurementContext) return { affiliateClickMeasurementStatus: "NOT_VERIFIED", reason: "CURRENT_PROOF_AND_HTML_REQUIRED", evidenceRef: null };
  const later = ledger.evidence.some((e) => e.recordId !== proof.recordId && e.metricOrClaim === "lp_measurement" &&
    e.isSynthetic === p.isSynthetic && e.scope.targetLP === proof.scope.targetLP && visibleAt(ledger, e, asOf) &&
    (Date.parse(e.recordedAt) >= Date.parse(proof.recordedAt) || e.value.verifiedAt && proof.value.verifiedAt &&
      Date.parse(e.value.verifiedAt) > Date.parse(proof.value.verifiedAt)));
  if (later) return { affiliateClickMeasurementStatus: "NOT_VERIFIED", reason: "NEWER_REGISTERED_MEASUREMENT_RECORD", evidenceRef: proof.recordId };
  const result = measurementAvailability(proof.value, { targetLP: p.scope.targetLP, currentPageHash: measurementContext.currentPageHash,
    ga4PropertyReference: context.ga4PropertyReference, at: asOf });
  return { affiliateClickMeasurementStatus: result.status, reason: result.reason, evidenceRef: proof.recordId,
    source: "SAVED_HTML_SNAPSHOT_ONLY", requiresStartTimeRevalidation: true };
}
const result = (c, status, reason, evidenceRefs = []) => ({ conditionId: c.conditionId, required: c.required, status, reason, evidenceRefs });
export function evaluateCondition(c, proposal, ledger, { asOf, measurement = null } = {}) {
  validateCondition(c); asOf = timestamp(asOf);
  const answer = (status, reason, refs = []) => ({ ...result(c, status, reason, refs), evaluatedAt: asOf });
  if (c.validFrom && Date.parse(asOf) < Date.parse(c.validFrom)) return answer("NOT_SATISFIED", "VALIDITY_NOT_STARTED");
  if (c.validUntil && Date.parse(asOf) > Date.parse(c.validUntil)) return answer("NOT_SATISFIED", "VALIDITY_EXPIRED");
  const ids = [...new Set([...c.evidenceRefs, ...(proposal.newEvidenceRefs ?? [])])];
  const records = ids.map((id) => ledger.evidence.find((e) => e.recordId === id)).filter(Boolean);
  const eligible = records.filter((e) => e.isSynthetic === proposal.isSynthetic && visibleAt(ledger, e, asOf) && e.evidenceType === "FACT" && e.value !== null && scopeCovers(e.scope, scope(c.scope)));
  if (c.type === "MEASUREMENT_VERIFIED") {
    if (c.scope.targetLP !== proposal.scope.targetLP) return answer("UNKNOWN", "CONDITION_LP_MISMATCH");
    const status = measurement?.affiliateClickMeasurementStatus ?? "NOT_VERIFIED";
    return answer(status === "VERIFIED" ? "SATISFIED" : status === "NOT_IMPLEMENTED" ? "NOT_SATISFIED" : "UNKNOWN",
      measurement?.reason ?? "MEASUREMENT_NOT_VERIFIED", measurement?.evidenceRef ? [measurement.evidenceRef] : []);
  }
  if (c.type === "NEW_EVIDENCE") {
    const e = c.expectedValue, same = eligible.filter((r) => r.metricOrClaim === e.metric);
    if (!same.length) return answer("UNKNOWN", "NO_APPLICABLE_OBSERVATION");
    const applicable = same.filter((r) => r.observedAt && r.observedAt > e.after.slice(0, 10) &&
      (e.maxAgeDays == null || (Date.parse(asOf) - Date.parse(`${r.observedAt}T00:00:00Z`)) / 86400000 <= e.maxAgeDays));
    if (applicable.length) return answer("SATISFIED", "NEW_SCOPED_OBSERVATION", applicable.map((r) => r.recordId));
    if (same.some((r) => !r.observedAt || r.observedAt === e.after.slice(0, 10))) return answer("UNKNOWN", "OBSERVATION_TIME_NOT_PRECISE_ENOUGH");
    return answer("NOT_SATISFIED", "NO_NEW_FRESH_OBSERVATION", same.map((r) => r.recordId));
  }
  if (c.type === "CHANGED_VARIABLE") {
    const expected = c.expectedValue, changes = (proposal.changes ?? []).filter((x) => x.field === expected.field &&
      canonical(x.from) === canonical(expected.from) && canonical(x.to) === canonical(expected.to));
    if (!changes.length) return answer("UNKNOWN", "DECLARED_CHANGE_MISSING");
    const proofs = changes.flatMap((x) => x.evidenceRefs).map((id) => ledger.evidence.find((e) => e.recordId === id)).filter((e) => e &&
      e.isSynthetic === proposal.isSynthetic && visibleAt(ledger, e, asOf) && e.evidenceType === "FACT" && e.metricOrClaim === expected.field &&
      scopeCovers(e.scope, scope(c.scope), [expected.field]));
    const before = proofs.filter((e) => canonical(e.value) === canonical(expected.from)), after = proofs.filter((e) => canonical(e.value) === canonical(expected.to));
    if (!before.length || !after.length) return answer("UNKNOWN", "CHANGE_REQUIRES_BEFORE_AND_AFTER_EVIDENCE");
    if (canonical(proposal.scope[expected.field]) !== canonical(expected.to)) return answer("NOT_SATISFIED", "PROPOSED_CONTEXT_NOT_CHANGED");
    return answer("SATISFIED", "DOCUMENTED_CHANGE_NOT_EXECUTION_PERMISSION", [...before, ...after].map((e) => e.recordId));
  }
  if (c.type === "OBSERVATION_WINDOW") {
    const end = c.expectedValue.endDate;
    if (asOf.slice(0, 10) < end) return answer("NOT_SATISFIED", "WINDOW_NOT_ENDED");
    const complete = eligible.filter((e) => e.period && e.period.end >= end && e.observedThrough >= end &&
      (!c.expectedValue.periodStart || e.period.start === c.expectedValue.periodStart) &&
      (e.coverage ?? e.sourceObservation?.coverage) === "COMPLETE" && (!c.expectedValue.final || e.sourceObservation.final === true));
    return complete.length ? answer("SATISFIED", "COMPLETE_OBSERVATION_WINDOW", complete.map((e) => e.recordId)) : answer("UNKNOWN", "COMPLETE_WINDOW_NOT_PROVEN");
  }
  const confirmations = (proposal.confirmations ?? []).filter((x) => x.conditionId === c.conditionId && x.reviewedBy === c.expectedValue.reviewer &&
    Date.parse(x.reviewedAt) <= Date.parse(asOf) && scopeCovers(scope(x.scope), scope(c.scope)));
  const proven = confirmations.find((x) => x.evidenceRefs.length && x.evidenceRefs.every((id) => eligible.some((r) => r.recordId === id)));
  return proven ? answer("SATISFIED", "EXPLICIT_REVIEW_CONFIRMATION_NOT_START_PERMISSION", proven.evidenceRefs) : answer("UNKNOWN", "REVIEW_CONFIRMATION_OR_EVIDENCE_MISSING");
}
export function aggregateConditions(conditions) {
  assert(conditions.every((c) => RETRY_STATES.includes(c.status)), "Invalid retry evaluation status");
  const required = conditions.filter((c) => c.required);
  if (!required.length) return "UNKNOWN";
  if (required.some((c) => c.status === "NOT_SATISFIED")) return "NOT_SATISFIED";
  if (required.some((c) => c.status === "UNKNOWN")) return "UNKNOWN";
  return "SATISFIED";
}
export function reviewProposal(ledger, proposal, { asOf, measurementContext = null } = {}) {
  validateProposal(proposal); asOf = timestamp(asOf);
  assert(purposeCompatible(ledger.purpose, proposal.purpose), "Proposal purpose mismatch");
  const snapshots = ledger.experimentSnapshots.filter((r) => r.isSynthetic === proposal.isSynthetic && visibleAt(ledger, r, asOf));
  for (const id of proposal.relatedExperimentIds ?? []) assert(snapshots.some((r) => r.experimentId === id), "Unknown related experiment");
  const referenced = [...(proposal.newEvidenceRefs ?? []), ...(proposal.changes ?? []).flatMap((c) => c.evidenceRefs),
    ...(proposal.confirmations ?? []).flatMap((c) => c.evidenceRefs), ...(proposal.measurement ? [proposal.measurement.evidenceRef] : [])];
  for (const ref of referenced) assert(ledger.evidence.some((e) => e.recordId === ref && e.isSynthetic === proposal.isSynthetic), "Proposal evidence missing or synthetic mismatch");
  const measurement = measurementForProposal(ledger, proposal, { asOf, measurementContext });
  const matches = [];
  for (const r of snapshots) {
    const match = matchScope(r.scope, proposal.scope, proposal.relatedExperimentIds);
    if (match !== "NO_MATCH") matches.push({ kind: "EXPERIMENT_RESULT", recordId: r.recordId, experimentId: r.experimentId, match,
      status: r.status, result: r.result, decision: r.decision, retryStatus: "UNKNOWN", reason: "LEGACY_RESULT_IS_NOT_RETRY_PERMISSION" });
  }
  const decisions = activeRevisions(ledger.decisions.filter((r) => r.isSynthetic === proposal.isSynthetic && visibleAt(ledger, r, asOf)), asOf);
  for (const group of decisions) for (const r of group.leaves) {
    const match = matchScope(r.scope, proposal.scope, proposal.relatedExperimentIds);
    if (match !== "NO_MATCH") matches.push({ kind: "RECORDED_DECISION", recordId: r.recordId, logicalId: r.logicalId,
      match, decision: r.decision, rawDecision: r.rawDecision ?? null, revisionState: group.state, retryPolicy: r.retryPolicy,
      retryStatus: "UNKNOWN", reason: r.decision === "KILL" ? "PREVIOUSLY_KILLED_REVIEW_REQUIRED" : "RECORDED_DECISION_NOT_EXECUTED" });
  }
  for (const group of activeRevisions(ledger.learnings.filter((r) => r.isSynthetic === proposal.isSynthetic && visibleAt(ledger, r, asOf)), asOf)) {
    for (const r of group.leaves) {
      const match = matchScope(r.scope, proposal.scope, proposal.relatedExperimentIds);
      if (match === "NO_MATCH") continue;
      const conditions = r.retryConditions.map((c) => evaluateCondition(c, proposal, ledger, { asOf, measurement }));
      const revisitComplete = text(proposal.WHY_REVISIT) && text(proposal.whatChanged) && proposal.newEvidenceRefs?.some((id) =>
        ledger.evidence.some((e) => e.recordId === id && visibleAt(ledger, e, asOf) && e.evidenceType === "FACT" && e.value !== null &&
          (scopeCovers(e.scope, scope(r.scope)) || e.metricOrClaim === "lp_measurement" && e.scope.targetLP && e.scope.targetLP === r.scope.targetLP) &&
          (e.observedAt > r.reviewedAt.slice(0, 10) || e.verifiedAt && Date.parse(e.verifiedAt) > Date.parse(r.reviewedAt))));
      const status = group.state === "ACTIVE" && r.reviewStatus === "ACCEPTED" && match === "EXACT_SCOPE" && revisitComplete ? aggregateConditions(conditions) : "UNKNOWN";
      matches.push({ kind: "LEARNING", recordId: r.recordId, learningId: r.logicalId, match, reviewStatus: r.reviewStatus, revisionState: group.state,
        retryStatus: status, conditions, reason: group.state === "CONFLICT" ? "CONFLICT_REQUIRES_RESOLUTION" : !revisitComplete ? "RETRY_REVIEW_INCOMPLETE" :
          match !== "EXACT_SCOPE" ? "CONTEXT_REVIEW_REQUIRED" : status === "SATISFIED" ? "CONDITIONS_SATISFIED_REVIEW_REQUIRED" : "CONDITIONS_NOT_PROVEN" });
    }
  }
  const overlaps = snapshots.filter((r) => r.status === "RUNNING" && r.scope.targetLP && r.scope.targetLP === proposal.scope.targetLP).map((r) => r.experimentId);
  return { proposalId: proposal.proposalId, isSynthetic: proposal.isSynthetic, scope: scope(proposal.scope), WHY_REVISIT: proposal.WHY_REVISIT ?? null,
    whatChanged: proposal.whatChanged ?? null, measurement, matches: matches.sort((a, b) => a.recordId.localeCompare(b.recordId)),
    status: matches.length ? "REVIEW_REQUIRED" : "NO_MATCH_FOUND", flags: [...(overlaps.length ? ["ACTIVE_EXPERIMENT_OVERLAP"] : []),
      ...(matches.some((m) => m.decision === "KILL") ? ["PREVIOUSLY_KILLED_REVIEW_REQUIRED"] : []),
      ...(proposal.purpose === "AFFILIATE_NOTE_ACQUISITION" && measurement.affiliateClickMeasurementStatus !== "VERIFIED" ? ["AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET"] : [])],
    activeExperimentIds: [...new Set(overlaps)].sort(), canStartExperiment: false, requiresStartTimeRevalidation: true };
}
