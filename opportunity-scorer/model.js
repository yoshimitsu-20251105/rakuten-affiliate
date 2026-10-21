import { assert, canonical, hash, date, timestamp, freshness, EVIDENCE_TYPES } from "../market-scanner/model.js";
import { canonicalLP } from "../funnel-measurement/model.js";
import { validateMeasurementRecord } from "../funnel-measurement/measurement-status.js";
import { COMPONENTS, MAX_SCORES, PERFORMANCE_METRICS, POLICY, POLICY_HASH } from "./policy.js";

export { assert, canonical, hash, date, timestamp, freshness };
export const SCHEMA_VERSION = 1;
export const OUTPUT_TYPE = "OPPORTUNITY_ASSESSMENTS_ONLY";
export const PURPOSES = ["AFFILIATE_MONETIZATION", "AFFILIATE_NOTE_ACQUISITION"];
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const isMissing = (value) => value == null || value === "" || value === "UNKNOWN";
export const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
export const textPresent = (value) => typeof value === "string" && value.trim().length > 0;
const digestPattern = /^[a-f0-9]{64}$/;
const checkPeriod = (period) => {
  assert(isObject(period), "period must be an object");
  date(period.start, "period.start"); date(period.end, "period.end");
  assert(period.start <= period.end, "period is reversed");
};

export function inputPointer(scanner, candidate, pointer) {
  const index = scanner.candidates.indexOf(candidate);
  const prefix = `/candidates/${index}/`;
  assert(typeof pointer === "string" && pointer.startsWith(prefix), "inputRef must address the same candidate");
  const parts = pointer.slice(prefix.length).split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  assert(["intent", "keywords", "availableLPs", "existingOffers", "purchaseIntent", "demandEvidence"].includes(parts[0]), "inputRef is not exploration evidence");
  let value = candidate;
  for (const part of parts) {
    assert(!["__proto__", "prototype", "constructor"].includes(part) && value != null && Object.hasOwn(value, part), "inputRef does not exist");
    value = value[part];
  }
  return value;
}

/** Validate before evaluation. The caller receives no mutable aliases in its output. */
export function validateInputs(scanner, context = null) {
  assert(scanner?.schemaVersion === 1 && scanner.outputType === "MARKET_CANDIDATES_ONLY", "unsupported Scanner contract");
  assert(identifier(scanner.runId), "invalid Scanner runId");
  timestamp(scanner.asOf, "Scanner asOf");
  assert(Array.isArray(scanner.candidates) && Array.isArray(scanner.evidence) && Array.isArray(scanner.inputs), "invalid Scanner collections");
  const inputs = new Map();
  for (const source of scanner.inputs.filter((s) => s.state !== "NOT_PROVIDED")) {
    assert(identifier(source.sourceId) && !inputs.has(source.sourceId) && digestPattern.test(source.sourceFileHash), "invalid/duplicate Scanner source");
    assert(typeof source.isSynthetic === "boolean", "source synthetic flag is required");
    inputs.set(source.sourceId, source);
  }
  for (const [sourceId, policy] of Object.entries(scanner.policy ?? {})) {
    assert(inputs.has(sourceId), "freshness policy has no source");
    freshness({ retrievedAt: null, periodEnd: null }, scanner.asOf, policy);
    assert(Object.values(policy).every((v) => Number.isInteger(v) && v >= 0), "invalid freshness threshold");
  }
  const evidence = new Map();
  for (const item of scanner.evidence) {
    assert(identifier(item.evidenceId) && !evidence.has(item.evidenceId), "invalid/duplicate evidenceId");
    assert(inputs.has(item.sourceId) && item.sourceFileHash === inputs.get(item.sourceId).sourceFileHash, "evidence source/hash mismatch");
    assert(EVIDENCE_TYPES.includes(item.evidenceType) && typeof item.isSynthetic === "boolean", "invalid evidence classification");
    assert(!inputs.get(item.sourceId).isSynthetic || item.isSynthetic, "synthetic source cannot become real evidence");
    if (item.retrievedAt != null) timestamp(item.retrievedAt, "evidence retrievedAt");
    for (const key of ["periodStart", "periodEnd"]) if (item[key] != null) date(item[key], key);
    assert(!(item.periodStart && item.periodEnd) || item.periodStart <= item.periodEnd, "reversed evidence period");
    evidence.set(item.evidenceId, item);
  }
  const candidates = new Map();
  const refs = (items, allowed = evidence) => {
    assert(Array.isArray(items) && items.every((id) => allowed.has(id)), "invalid evidence reference");
  };
  for (const candidate of scanner.candidates) {
    assert(identifier(candidate.candidateId) && !candidates.has(candidate.candidateId) && typeof candidate.isSynthetic === "boolean", "invalid/duplicate candidate");
    refs(candidate.evidenceRefs);
    refs(candidate.demandEvidence, new Map(candidate.evidenceRefs.map((id) => [id, evidence.get(id)])));
    assert(isObject(candidate.intent) && EVIDENCE_TYPES.includes(candidate.intent.evidenceType), "invalid candidate intent");
    assert(Array.isArray(candidate.availableLPs) && Array.isArray(candidate.existingOffers) && Array.isArray(candidate.measurementReadiness) && Array.isArray(candidate.relatedExperiments), "invalid candidate associations");
    for (const lp of candidate.availableLPs) canonicalLP(lp.targetLP);
    for (const measurement of candidate.measurementReadiness) {
      assert(candidate.availableLPs.some((lp) => lp.targetLP === measurement.targetLP), "measurement LP mismatch");
      assert(["VERIFIED", "NOT_VERIFIED", "NOT_IMPLEMENTED"].includes(measurement.affiliateClickMeasurementStatus), "invalid measurement status");
      refs(measurement.evidenceRefs ?? []);
      if (measurement.affiliateClickMeasurementStatus === "VERIFIED") {
        assert(textPresent(measurement.evidenceId), "VERIFIED needs evidenceId");
        const proofs = (measurement.evidenceRefs ?? []).map((id) => evidence.get(id).value).filter((r) => r?.evidenceId === measurement.evidenceId && r.targetLP === measurement.targetLP);
        assert(proofs.length === 1, "VERIFIED needs one saved proof");
        validateMeasurementRecord(proofs[0]);
      }
    }
    for (const key of PERFORMANCE_METRICS) {
      const metric = candidate.observedRevenueEvidence?.[key];
      assert(isObject(metric) && EVIDENCE_TYPES.includes(metric.evidenceType), "invalid performance metric");
      assert(metric.value === null || (typeof metric.value === "number" && Number.isFinite(metric.value) && metric.value >= 0), "invalid performance value");
      if (metric.period != null) checkPeriod(metric.period);
      if (metric.observedThrough != null) date(metric.observedThrough, "observedThrough");
      for (const field of ["retrievedAt", "snapshotAsOf"]) if (metric[field] != null) timestamp(metric[field], field);
      refs(metric.evidenceRefs ?? []);
      assert((metric.evidenceRefs ?? []).every((id) => candidate.evidenceRefs.includes(id)), "performance evidence belongs to another candidate");
    }
    candidates.set(candidate.candidateId, candidate);
  }
  if (context === null) return { inputs, evidence, candidates, contexts: [] };
  assert(context?.schemaVersion === SCHEMA_VERSION && PURPOSES.includes(context.purpose) && Array.isArray(context.assessments), "invalid assessment context");
  if (context.policyVersion !== undefined) assert(context.policyVersion === POLICY.version, "unsupported policy version");
  if (context.policyHash !== undefined) assert(context.policyHash === POLICY_HASH, "policy hash mismatch");
  if (context.scannerRunId !== undefined) assert(context.scannerRunId === scanner.runId, "Scanner run mismatch");
  const seen = new Set();
  for (const row of context.assessments) {
    const c = candidates.get(row.candidateId), identity = hash([row.candidateId, row.contextId]);
    assert(c && identifier(row.contextId) && !seen.has(identity), "invalid/duplicate assessment context"); seen.add(identity);
    assert(PURPOSES.includes(row.purpose ?? context.purpose) && typeof row.isSynthetic === "boolean" && row.isSynthetic === c.isSynthetic, "context purpose/synthetic mismatch");
    if (row.targetLP != null) assert(c.availableLPs.some((lp) => lp.targetLP === canonicalLP(row.targetLP)), "context LP is not linked");
    assert(row.itemCodes === undefined || (Array.isArray(row.itemCodes) && row.itemCodes.every((code) => c.existingOffers.some((offer) => offer.itemCode === code))), "context offer is not linked");
    assert(row.scope == null || textPresent(row.scope), "context scope must be a nonempty reference");
    assert(row.channel == null || textPresent(row.channel), "invalid channel");
    for (const key of ["country", "language"]) assert(row[key] == null || typeof row[key] === "string" && (!c[key] || row[key] === c[key]), "context region mismatch");
    timestamp(row.assessedAt, "assessedAt"); checkPeriod(row.applicablePeriod);
    assert(textPresent(row.assessedBy) && isObject(row.components), "assessment metadata is required");
    assert(Object.keys(row.components).every((key) => COMPONENTS.includes(key)), "unsupported component");
    for (const [key, claims] of Object.entries(row.components)) for (const claim of Array.isArray(claims) ? claims : [claims]) {
      assert(isObject(claim) && claim.maxScore === MAX_SCORES[key], "component maxScore mismatch");
      assert(isMissing(claim.value) || (typeof claim.value === "number" && Number.isFinite(claim.value) && claim.value >= 0 && claim.value <= MAX_SCORES[key]), "invalid component value");
      assert(["HYPOTHESIS", "UNKNOWN"].includes(claim.evidenceType), "component points are hypotheses");
      refs(claim.evidenceRefs ?? [], new Map(c.evidenceRefs.map((id) => [id, evidence.get(id)])));
      assert((claim.evidenceRefs ?? []).every((id) => inputs.get(evidence.get(id).sourceId).sourceType !== "funnel_report"), "financial evidence cannot be exploration points");
      assert(claim.inputRefs === undefined || Array.isArray(claim.inputRefs), "inputRefs must be an array");
      for (const pointer of claim.inputRefs ?? []) inputPointer(scanner, c, pointer);
      if (!isMissing(claim.value) && claim.evidenceType !== "UNKNOWN") assert(textPresent(claim.reason ?? claim.rationale) && ((claim.evidenceRefs?.length ?? 0) + (claim.inputRefs?.length ?? 0) > 0), "known points need rationale and evidence");
      if (key === "demand") assert(!(claim.inputRefs?.length) && (claim.evidenceRefs ?? []).every((id) => c.demandEvidence.includes(id)), "demand points need demand observations");
    }
  }
  return { inputs, evidence, candidates, contexts: context.assessments };
}
