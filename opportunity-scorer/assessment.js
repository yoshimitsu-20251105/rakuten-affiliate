import { hash, canonical, freshness, isMissing, textPresent, inputPointer } from "./model.js";
import { COMPONENTS, MAX_SCORES, PERFORMANCE_METRICS, POLICY, POLICY_HASH, totalScore } from "./policy.js";

const periodFor = (e) => ({ evidenceId: e.evidenceId, start: e.periodStart ?? null, end: e.periodEnd ?? null, timezone: e.timezone ?? null, scope: e.scope ?? null });
const sourceFor = (e, inputs) => ({ evidenceId: e.evidenceId, sourceId: e.sourceId, sourceType: inputs.get(e.sourceId).sourceType,
  provider: e.provider ?? null, sourceReference: e.sourceReference ?? null, sourceFileHash: e.sourceFileHash,
  sourceRecordReference: e.sourceRecordReference ?? null, retrievedAt: e.retrievedAt ?? null, evidenceType: e.evidenceType, isSynthetic: e.isSynthetic });
const freshFor = (e, scanner, asOf) => freshness({ retrievedAt: e.retrievedAt ?? null, periodEnd: e.periodEnd ?? null }, asOf, scanner.policy?.[e.sourceId] ?? {});

function component(scanner, candidate, context, key, index, asOf, scannerHash) {
  const specified = context?.components[key];
  const claims = specified === undefined ? [] : Array.isArray(specified) ? specified : [specified];
  const unique = [...new Map(claims.map((claim) => [hash(claim), claim])).values()];
  let raw = unique.length === 1 ? unique[0] : null;
  let derived = false;
  if (!claims.length && key === "purchaseIntent") {
    const value = POLICY.intentPoints[candidate.intent.value];
    if (value !== undefined && candidate.intent.evidenceType !== "UNKNOWN") {
      derived = true;
      raw = { value, maxScore: MAX_SCORES[key], evidenceType: "HYPOTHESIS", reason: "INTENT_RULE_INITIAL_HYPOTHESIS_NOT_PURCHASE_PROOF",
        evidenceRefs: candidate.evidenceRefs.filter((id) => index.evidence.get(id).metricOrClaim === "theme_seed"),
        inputRefs: [`/candidates/${scanner.candidates.indexOf(candidate)}/intent`] };
    }
  }
  const refs = [...new Set(claims.length > 1 ? claims.flatMap((v) => v.evidenceRefs ?? []) : raw?.evidenceRefs ?? [])].sort();
  const pointers = [...new Set(claims.length > 1 ? claims.flatMap((v) => v.inputRefs ?? []) : raw?.inputRefs ?? [])].sort();
  const records = refs.map((id) => index.evidence.get(id));
  const observations = records.map((e) => ({ evidenceId: e.evidenceId, ...freshFor(e, scanner, asOf) }));
  const sources = records.map((e) => sourceFor(e, index.inputs));
  for (const pointer of pointers) {
    const value = inputPointer(scanner, candidate, pointer);
    sources.push({ sourceId: null, sourceType: "scanner_snapshot", provider: "scanner_snapshot", sourceReference: `run:${scanner.runId}${pointer}`,
      sourceFileHash: scannerHash, retrievedAt: null, observedAt: scanner.asOf, evidenceType: value?.evidenceType ?? "UNKNOWN",
      reason: "SCANNER_FIELD_REFERENCE_NOT_BLANKET_FACT", isSynthetic: candidate.isSynthetic });
  }
  let missingReason = null;
  if (unique.length > 1) missingReason = "CONFLICT";
  else if (!raw || isMissing(raw.value)) missingReason = "NOT_PROVIDED";
  else if (raw.evidenceType === "UNKNOWN") missingReason = "UNKNOWN_EVIDENCE";
  else if (context && !derived && Date.parse(context.assessedAt) > Date.parse(asOf)) missingReason = "ASSESSMENT_AFTER_AS_OF";
  else if (context && !derived && (context.applicablePeriod.start > asOf.slice(0, 10) || context.applicablePeriod.end < asOf.slice(0, 10))) missingReason = "ASSESSMENT_OUTSIDE_APPLICABLE_PERIOD";
  else if (records.some((e) => e.isSynthetic !== candidate.isSynthetic)) missingReason = "SYNTHETIC_MISMATCH";
  else if (records.some((e) => e.value === null || e.evidenceType === "UNKNOWN")) missingReason = "UNKNOWN_EVIDENCE";
  else if (observations.some((f) => f.status === "AFTER_AS_OF")) missingReason = "EVIDENCE_AFTER_AS_OF";
  else if (observations.some((f) => f.status === "STALE")) missingReason = "STALE_EVIDENCE";
  else if (key === "demand" && (!records.length || records.some((e) => !e.periodStart || !e.periodEnd || !e.retrievedAt || !e.country || !e.language || !e.timezone || !e.grain) || observations.some((f) => f.status !== "WITHIN_POLICY"))) missingReason = "CURRENT_DEMAND_NOT_ESTABLISHED";
  else if (key === "demand" && raw.value === 0 && records.every((e) => ["gsc_csv", "gsc_report"].includes(index.inputs.get(e.sourceId).sourceType) && e.value === 0)) missingReason = "ZERO_GSC_NOT_MARKET_DEMAND_PROOF";
  const value = missingReason ? null : raw.value;
  return {
    value, maxScore: MAX_SCORES[key], evidenceRefs: refs, evidenceType: value === null ? "UNKNOWN" : "HYPOTHESIS", source: sources,
    period: { applicablePeriod: derived ? null : context?.applicablePeriod ?? null, evidencePeriods: records.map(periodFor) },
    freshness: { asOf, status: missingReason === null ? (derived ? "STATIC_RULE_SNAPSHOT" : "ASSESSMENT_APPLICABLE") : missingReason,
      assessedAt: derived ? null : context?.assessedAt ?? null, scannerAsOf: scanner.asOf, observations },
    reason: value === null ? "NO_POINTS_ASSIGNED" : raw.reason ?? raw.rationale,
    missingReason, inputRefs: pointers, originalAssessments: structuredClone(claims), derivedFromRule: derived,
  };
}

function verifiedMetric(scanner, candidate, key, index, asOf) {
  const raw = candidate.observedRevenueEvidence[key];
  const records = (raw.evidenceRefs ?? []).map((id) => index.evidence.get(id));
  let missingReason = raw.value === null ? raw.reason ?? "NOT_OBSERVED" : null;
  let proven = null;
  if (!missingReason && raw.evidenceType !== "FACT") missingReason = "NON_FACT_PERFORMANCE";
  if (!missingReason && (candidate.isSynthetic || raw.isSynthetic === true)) missingReason = "SYNTHETIC_NOT_OBSERVED_PERFORMANCE";
  if (!missingReason && raw.availability !== "OBSERVED") missingReason = "MISSING_OR_PARTIAL_PERFORMANCE";
  if (!missingReason && key === "conversions" && raw.validationStatus !== "VERIFIED") missingReason = "CONVERSION_GRAIN_NOT_VERIFIED";
  if (!missingReason) {
    const matches = records.filter((e) => index.inputs.get(e.sourceId).sourceType === "funnel_report" && e.metricOrClaim === `attributed_${key}` &&
      e.evidenceType === "FACT" && e.availability === "OBSERVED" && e.value === raw.value && !e.isSynthetic);
    const matchesFrom = [];
    for (const e of matches) for (const saved of scanner.runContext?.funnelReports ?? []) {
      const report = saved.report, batch = report?.sourceBatch;
      if (saved.sourceId !== e.sourceId || !batch || report.schemaVersion !== 1 || report.purpose !== "AFFILIATE_FUNNEL_MEASUREMENT") continue;
      const sourceMetric = report.byMeasurementId?.find((entry) => entry.measurementId === raw.scope?.measurementId)?.metrics?.[key];
      const fields = ["value", "evidenceType", "availability", "currency", "scope", "period", "snapshotAsOf", "retrievedAt", "observedThrough", "dateBasis", "timezone", "grain", "validationStatus", "periodStatus", "final"];
      const same = sourceMetric && fields.every((field) => canonical(sourceMetric[field] ?? null) === canonical(raw[field] ?? null));
      const validScope = textPresent(raw.scope?.measurementId) && raw.scope?.accountScopeId === batch.accountScopeId &&
        e.scope?.candidateId === candidate.candidateId && e.scope?.observedScope?.measurementId === raw.scope.measurementId && e.scope?.observedScope?.accountScopeId === batch.accountScopeId && textPresent(raw.mappingEvidenceReference);
      const validPeriod = raw.period?.start === batch.periodStart && raw.period?.end === batch.periodEnd && e.periodStart === batch.periodStart && e.periodEnd === batch.periodEnd &&
        raw.snapshotAsOf === batch.snapshotAsOf && raw.grain === "MEASUREMENT_ID" && raw.timezone === batch.timezone && raw.dateBasis === batch.dateBasis &&
        textPresent(raw.observedThrough) && raw.observedThrough >= batch.periodStart && raw.observedThrough <= batch.periodEnd;
      const validSource = !saved.isSynthetic && !batch.isSynthetic && !index.inputs.get(e.sourceId).isSynthetic && batch.recordCount > 0 && batch.coverage === "COMPLETE" &&
        raw.importId === batch.importId && e.sourceRecordReference === batch.importId &&
        Date.parse(batch.snapshotAsOf) <= Date.parse(asOf) && Number.isFinite(Date.parse(raw.retrievedAt)) && Date.parse(raw.retrievedAt) <= Date.parse(asOf) &&
        (!index.inputs.get(e.sourceId).retrievedAt || Date.parse(index.inputs.get(e.sourceId).retrievedAt) <= Date.parse(asOf));
      const validCurrency = /^[A-Z]{3}$/.test(batch.currency ?? "") && (key === "conversions" || raw.currency === batch.currency);
      if (same && validScope && validPeriod && validSource && validCurrency) matchesFrom.push({ e, report, batch });
    }
    if (matchesFrom.length !== 1) missingReason = "FUNNEL_FACT_PROVENANCE_NOT_ESTABLISHED";
    else proven = matchesFrom[0];
  }
  if (!missingReason && key === "epc" && proven.report.attribution?.epcCompatibility?.compatible !== true) missingReason = "CLICK_COHORT_NOT_VERIFIED";
  const value = missingReason ? null : raw.value;
  return { value, evidenceType: value === null ? "UNKNOWN" : "FACT", availability: value === null ? raw.availability === "OBSERVED" ? "NOT_COMPARABLE" : raw.availability : "OBSERVED",
    reason: missingReason, missingReason, evidenceRefs: [...(raw.evidenceRefs ?? [])], source: records.map((e) => sourceFor(e, index.inputs)),
    sourceObservation: structuredClone(raw), period: raw.period ?? null, currency: raw.currency ?? null,
    validationStatus: raw.validationStatus ?? null, final: raw.final ?? null,
    context: proven && !missingReason ? { period: raw.period, observedThrough: raw.observedThrough, snapshotAsOf: raw.snapshotAsOf,
      currency: proven.batch.currency, timezone: raw.timezone, dateBasis: raw.dateBasis, coverage: proven.batch.coverage,
      grain: raw.grain, accountScopeId: raw.scope.accountScopeId, periodStatus: raw.periodStatus ?? null, final: raw.final ?? null,
      country: candidate.country ?? null, language: candidate.language ?? null } : null };
}

/** Observations are not scores. This function never calls exploration assessment. */
export function assessObservedPerformance(scanner, index, { asOf }) {
  const rows = scanner.candidates.map((c) => ({ candidateId: c.candidateId, isSynthetic: c.isSynthetic,
    metrics: Object.fromEntries(PERFORMANCE_METRICS.map((key) => [key, verifiedMetric(scanner, c, key, index, asOf)])),
    comparisonGroup: null, performanceRank: null, comparisonDepth: [], comparisonReasons: [] }));
  const claims = new Map();
  for (const row of rows) for (const metric of Object.values(row.metrics)) if (metric.sourceObservation.value !== null && textPresent(metric.sourceObservation.scope?.accountScopeId) && textPresent(metric.sourceObservation.scope?.measurementId)) {
    const key = hash(metric.sourceObservation.scope);
    if (!claims.has(key)) claims.set(key, new Set());
    claims.get(key).add(row.candidateId);
  }
  for (const row of rows) for (const metric of Object.values(row.metrics)) if (metric.value !== null && claims.get(hash(metric.sourceObservation.scope)).size > 1) {
    metric.value = null; metric.evidenceType = "UNKNOWN"; metric.context = null;
    metric.availability = "UNATTRIBUTABLE"; metric.reason = metric.missingReason = "SHARED_MEASUREMENT_ID_NOT_EXCLUSIVE";
  }
  return rows;
}

/** Hypothesis points only. No performance metric is read by the score calculation. */
export function assessExploration(scanner, index, { asOf, scannerHash, contextPurpose = "AFFILIATE_MONETIZATION" }) {
  const rows = [];
  for (const c of scanner.candidates) {
    const contexts = index.contexts.filter((row) => row.candidateId === c.candidateId);
    for (const context of contexts.length ? contexts : [null]) {
      const purpose = context?.purpose ?? contextPurpose;
      const components = Object.fromEntries(COMPONENTS.map((key) => [key, component(scanner, c, context, key, index, asOf, scannerHash)]));
      const contextId = context?.contextId ?? "default";
      const measurementReadiness = c.measurementReadiness.filter((r) => !context?.targetLP || r.targetLP === context.targetLP).map((r) => ({ ...structuredClone(r),
        statusScope: "SCANNER_SNAPSHOT_ONLY", requiresStartTimeRevalidation: true, canStartExperiment: false }));
      const constraints = [...(c.reviewFlags ?? [])];
      if (purpose === "AFFILIATE_NOTE_ACQUISITION" && (!context?.targetLP || !measurementReadiness.length || measurementReadiness.some((r) => r.affiliateClickMeasurementStatus !== "VERIFIED"))) constraints.push("NOTE_START_REQUIRES_VERIFIED");
      const relatedExperiments = structuredClone(c.relatedExperiments);
      const overlap = relatedExperiments.some((e) => e.status === "RUNNING");
      if (overlap) constraints.push("RUNNING_EXPERIMENT_REQUIRES_OVERLAP_REVIEW");
      if (relatedExperiments.some((e) => e.decision === "KILL")) constraints.push("WHY_REVISIT_REQUIRES_NEW_EVIDENCE");
      rows.push({ assessmentId: hash([c.candidateId, contextId]), candidateId: c.candidateId, contextId, schemaVersion: 1,
        scannerRunId: scanner.runId, scannerFileHash: scannerHash, asOf, purpose, targetLP: context?.targetLP ?? null,
        itemCodes: context?.itemCodes ?? [], channel: context?.channel ?? null, country: context?.country ?? c.country ?? null,
        language: context?.language ?? c.language ?? null, scope: context?.scope ?? null, isSynthetic: c.isSynthetic,
        theme: structuredClone(c.theme ?? null), components, exploration: { totalScore: totalScore(components), maxScore: 100, evidenceType: "HYPOTHESIS", policyVersion: POLICY.version, policyHash: POLICY_HASH },
        comparisonGroup: null, explorationRank: null, comparisonReasons: [], candidatePerformanceRef: c.candidateId,
        measurementReadiness, requiresStartTimeRevalidation: true, canStartExperiment: false, requiresOverlapReview: overlap,
        relatedExperiments, priorDecisions: structuredClone(c.priorDecisions ?? []), counterEvidence: structuredClone(c.counterEvidence ?? []),
        constraints: [...new Set(constraints)].sort(), unknowns: structuredClone(c.unknowns ?? []),
        nextEvidenceNeeded: COMPONENTS.filter((key) => components[key].value === null).map((component) => ({ component, reason: components[component].missingReason })),
        outputType: "OPPORTUNITY_ASSESSMENTS_ONLY" });
    }
  }
  return rows.sort((a, b) => a.assessmentId.localeCompare(b.assessmentId));
}
