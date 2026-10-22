import { evaluateProposal, concurrency } from "../experiment-selector/gates.js";
import { comparisonValue } from "../experiment-selector/selection.js";
import { measurementForProposal } from "../learning-engine/retry.js";
import { learningProposal } from "../experiment-selector/model.js";
import { measurementAvailability, assertNewAffiliateNoteExperimentAllowed } from "../funnel-measurement/measurement-status.js";
import { hash, canonical, ageDays, within, reason, PROTOCOL_FIELDS } from "./model.js";

export function currentSelectorInput(b) {
  return { ...b.original, ...b.current, asOf: b.asOf, index: b.original.index, hashes: { ...b.original.hashes, ...b.current.hashes } };
}
export const currentCapacity = (b) => b.current.selectionContext.policy.monetizationGroups.map((g) => concurrency(currentSelectorInput(b), g));
export function evaluateGates(b, profile) {
  const p = b.selectedProposal, cp = b.currentProposal, config = b.planningContext, plan = config.plan;
  const reasons = [...b.sourceIssues], input = currentSelectorInput(b), protocol = p.variables.acquisition ?? null;
  const add = (code, status, sourceId = "planningContext", path = "/plan") => reasons.push(reason(code, status, sourceId, path));
  if (config.selectedProposalId !== p.proposalId || plan && (plan.candidateId !== p.candidateId || plan.channel !== p.channel || plan.targetLP !== p.targetLP)) add("SELECTED_SCOPE_MISMATCH", "BLOCKED");
  if (!plan) add("PLANNING_CONTEXT_MISSING", "MANUAL_REVIEW_REQUIRED");
  if (plan?.experimentId === p.proposalId) add("PROPOSAL_ID_IS_NOT_EXPERIMENT_ID", "BLOCKED");
  if (!profile) add("CHANNEL_PROFILE_NOT_SUPPORTED", "MANUAL_REVIEW_REQUIRED");
  else if (profile.purpose !== p.purpose) add("CHANNEL_PURPOSE_MISMATCH", "BLOCKED");
  if (b.purpose === "AFFILIATE_NOTE_ACQUISITION" && p.purpose !== b.purpose) add("AFFILIATE_PURPOSE_SCOPE_MISMATCH", "BLOCKED");
  if (ageDays(b.asOf, b.selectorReport.asOf) > config.policy.maxSelectorAgeDays) add("SELECTOR_RECOMMENDATION_STALE", "MANUAL_REVIEW_REQUIRED", "selectorReport", "/asOf");
  if (ageDays(b.asOf, config.policy.configuredAt) < 0 || !within(config.policy.applicablePeriod, b.asOf)) add("PLANNING_POLICY_NOT_APPLICABLE", "MANUAL_REVIEW_REQUIRED", "planningContext", "/policy");
  if (!protocol) add("SELECTED_ACQUISITION_PROTOCOL_NOT_DEFINED", "MANUAL_REVIEW_REQUIRED", "original.selectionContext", "/proposals");
  for (const k of PROTOCOL_FIELDS) if (plan && protocol && canonical(plan[k] ?? null) !== canonical(protocol[k] ?? null)) add("SELECTED_PROTOCOL_MODIFIED", "BLOCKED", "planningContext", `/plan/${k}`);
  if (profile && plan) {
    if (plan.contentPurpose == null || plan.requiredTrafficGrain == null) add("CHANNEL_PLAN_CAPABILITY_UNKNOWN", "MANUAL_REVIEW_REQUIRED");
    else if (plan.contentPurpose !== profile.contentPurpose || plan.requiredTrafficGrain !== profile.trafficGrain) add("CHANNEL_PLAN_CAPABILITY_MISMATCH", "BLOCKED");
    if (!plan.requiredMetrics?.length) add("REQUIRED_METRICS_NOT_DEFINED", "MANUAL_REVIEW_REQUIRED");
    else if (!plan.requiredMetrics.includes(p.primaryMetric)) add("PRIMARY_METRIC_NOT_PRESERVED", "BLOCKED");
    if (!plan.fixedVariables || !plan.changedVariable || profile.utmApplicable && (!plan.contentPattern || !plan.ctaPattern)) add("REQUIRED_PLAN_METADATA_UNKNOWN", "MANUAL_REVIEW_REQUIRED");
    if (plan.changedVariable && (profile.utmApplicable ? !["channel", "contentPattern", "titlePattern", "ctaPattern"].includes(plan.changedVariable.name) : plan.changedVariable.name != null)) add("UNSUPPORTED_CHANGED_VARIABLE", "BLOCKED");
  }
  if ([p.variables, protocol?.fixedVariables].some((v) => v && ["requiresLPChange", "requiresCTAChange", "requiresAffiliateUrlChange", "requiresTrackingChange"].some((k) => v[k] === true))) add("PROTECTED_ASSET_CHANGE_REQUIRED", "BLOCKED");
  const candidate = b.original.index.candidates.get(p.candidateId), lp = candidate.availableLPs.find((l) => l.targetLP === p.targetLP);
  const currentHash = b.current.measurementContexts[p.proposalId]?.currentPageHash;
  if (!currentHash || !lp.repositoryPageHash) add("CURRENT_OR_ORIGINAL_LP_HASH_MISSING", "MANUAL_REVIEW_REQUIRED", "currentStateManifest", "/htmlSnapshots");
  else if (currentHash !== lp.repositoryPageHash) add("FIXED_VARIABLE_DRIFT", "BLOCKED", "currentStateManifest", "/htmlSnapshots");
  const measurement = measurementForProposal(b.current.learningLedger, learningProposal({ ...p, measurement: cp.measurement }, b.isSynthetic), { asOf: b.asOf, measurementContext: b.current.measurementContexts[p.proposalId] ?? null });
  const proof = b.current.learningLedger.evidence.find((e) => e.recordId === measurement.evidenceRef)?.value;
  if (proof && p.scope.period && measurement.affiliateClickMeasurementStatus === "VERIFIED") {
    const r = measurementAvailability(proof, { targetLP: p.targetLP, currentPageHash: currentHash, ga4PropertyReference: cp.measurement?.ga4PropertyReference, period: p.scope.period, at: b.asOf });
    measurement.affiliateClickMeasurementStatus = r.status; measurement.reason = r.reason;
  }
  if (p.purpose === "AFFILIATE_NOTE_ACQUISITION") {
    if (measurement.affiliateClickMeasurementStatus !== "VERIFIED") add("AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET", "BLOCKED", "current.learningLedger", "/evidence");
    else if (plan?.experimentId) assertNewAffiliateNoteExperimentAllowed({ purpose: p.purpose, experimentId: plan.experimentId, measurementRecord: proof,
      targetLP: p.targetLP, currentPageHash: currentHash, ga4PropertyReference: cp.measurement.ga4PropertyReference, at: b.asOf });
  }
  if (plan?.requiredMetrics?.some((m) => ["affiliateClicks", "epc"].includes(m)) && measurement.affiliateClickMeasurementStatus !== "VERIFIED") add("REQUIRED_CLICK_MEASUREMENT_NOT_VERIFIED", "BLOCKED", "current.learningLedger", "/evidence");
  if (plan?.requiredMetrics?.includes("epc")) add("REQUIRED_EPC_COHORT_LINK_UNAVAILABLE", "BLOCKED", "planningContext", "/plan/requiredMetrics");
  if (plan?.requiredMetrics?.includes("conversions")) add("CONVERSION_GRAIN_PARTIALLY_VERIFIED", "MANUAL_REVIEW_REQUIRED", "planningContext", "/plan/requiredMetrics");
  const currentProof = cp.measurement?.evidenceRef && b.current.learningLedger.evidence.find((e) => e.recordId === cp.measurement.evidenceRef);
  let review = null;
  const refs = [...(cp.newEvidenceRefs ?? []), ...(cp.changes ?? []).flatMap((r) => r.evidenceRefs), ...(cp.confirmations ?? []).flatMap((r) => r.evidenceRefs)];
  const canReview = cp.relatedExperimentIds.every((id) => b.current.learningLedger.experimentSnapshots.some((s) => s.experimentId === id)) && refs.every((id) => b.current.learningLedger.evidence.some((e) => e.recordId === id)) && (!cp.measurement || currentProof);
  if (canReview) {
    review = evaluateProposal(input, cp);
    for (const code of review.rejectionReason) {
      const blocked = ["MONETIZATION_GROUP_LIMIT_REACHED", "REQUIRED_RETRY_CONDITION_NOT_SATISFIED", "RUNNING_LP_OR_MEASUREMENT_INTERFERENCE", "DECLARED_LP_OR_OFFER_UNAVAILABLE", "AFFILIATE_NOTE_VERIFIED_GATE_NOT_MET"].includes(code);
      add(code, blocked ? "BLOCKED" : "MANUAL_REVIEW_REQUIRED", "current.learningLedger", "/");
    }
  } else add("CURRENT_HISTORY_EVIDENCE_MISSING", "MANUAL_REVIEW_REQUIRED", "current.learningLedger", "/");
  // Check the selected assessment only. Never rank or select another proposal at
  // the current time, even if the old recommendation is no longer supportable.
  const comparison = comparisonValue(input, p);
  if (comparison.reason) add(comparison.reason, "MANUAL_REVIEW_REQUIRED", "original.scorerReport", "/assessments");
  const capacity = concurrency(input, p.monetizationGroup);
  if (capacity.status !== "PASS") add(capacity.reason, capacity.status === "DEFERRED" ? "BLOCKED" : "MANUAL_REVIEW_REQUIRED", "current.selectionContext", "/registry");
  const confirmations = [];
  for (const checkId of ["TRAFFIC_GRAIN", "CHANNEL_HANDOFF"]) {
    const c = config.checklistConfirmations.find((r) => r.checkId === checkId);
    const valid = c && c.proposalId === p.proposalId && c.targetLP === p.targetLP && c.channel === p.channel && c.pageHash === currentHash && c.policyHash === config.policy.policyHash &&
      ageDays(b.asOf, c.reviewedAt) >= 0 && ageDays(b.asOf, c.reviewedAt) <= config.policy.maxProofAgeDays;
    const status = valid ? c.status : "UNKNOWN"; confirmations.push({ checkId, phase: "PLAN", status, requiredForPlanReadiness: true, confirmation: c ?? null });
    if (status !== "PASS") add(status === "FAIL" ? `${checkId}_NOT_AVAILABLE` : `${checkId}_REVIEW_REQUIRED`, status === "FAIL" ? "BLOCKED" : "MANUAL_REVIEW_REQUIRED", "planningContext", "/checklistConfirmations");
  }
  return { reasons, protocol, measurement, measurementVerification: { effective: measurement, originalStatus: b.selectorReport.proposals.find((r) => r.proposalId === p.proposalId)?.measurementGateStatus ?? "NOT_VERIFIED",
    record: proof ?? null, currentHTMLHash: currentHash ?? null, ga4PropertyReference: cp.measurement?.ga4PropertyReference ?? null, evaluatedAt: b.asOf,
    verificationScope: "SAVED_REPOSITORY_HTML_AND_LEDGER_NOT_LIVE_REMEASUREMENT" },
    retryReview: review?.retry ?? { status: "UNKNOWN", required: true }, historyReview: review?.historyReview ?? null, counterEvidence: review?.counterEvidence ?? [],
    concurrencyReview: capacity, interferenceReview: review?.interferenceExperimentIds ?? null, comparisonPremise: comparison, confirmations,
    fixedVariables: { targetLP: p.targetLP, pageHash: lp.repositoryPageHash ?? null, itemCodes: p.itemCodes, approvedVariables: protocol?.fixedVariables ?? null } };
}
