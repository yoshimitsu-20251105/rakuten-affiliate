import { createHash } from "node:crypto";
import { canonicalLP, assertDate, assertTimestamp } from "../funnel-measurement/model.js";

export { canonicalLP };
export const SCHEMA_VERSION = 1;
export const OUTPUT_TYPE = "EXPERIMENT_LEARNING_REVIEW_ONLY";
export const PURPOSES = ["AFFILIATE_MONETIZATION", "AFFILIATE_NOTE_ACQUISITION"];
export const ACTIONS = ["KILL", "IMPROVE", "HOLD", "SCALE"];
export const EVIDENCE_TYPES = ["FACT", "ESTIMATE", "HYPOTHESIS", "UNKNOWN"];
export const RETRY_STATES = ["SATISFIED", "NOT_SATISFIED", "UNKNOWN"];
export const COLLECTIONS = ["sourceImports", "experimentSnapshots", "evidence", "decisions", "learnings"];
export const METRICS = ["approvedRevenue", "revenue", "conversions", "epc"];
export const PREDICATES = Object.freeze({ MEASUREMENT_VERIFIED: "VALID_AT_REVIEW", NEW_EVIDENCE: "OBSERVED_AFTER_REVIEW",
  CHANGED_VARIABLE: "DECLARED_CHANGE", OBSERVATION_WINDOW: "COMPLETE_THROUGH", REVIEW_CONFIRMATION: "REVIEWED" });
export const SCOPE_KEYS = ["experimentIds", "theme", "opportunityIds", "candidateIds", "itemCodes", "channel", "arm", "targetLP",
  "contentPattern", "titlePattern", "CTA", "category", "priceBand", "country", "language", "period", "accountScopeId", "measurementId"];
const ARRAY_SCOPES = ["experimentIds", "opportunityIds", "candidateIds", "itemCodes"];
export const POLICY = Object.freeze({ version: "learning-v1", retryStates: RETRY_STATES, predicates: PREDICATES,
  automatedActions: false, revenueImputation: false, combinedRanking: false, knowledgeCutoff: "RECORDED_AND_OBSERVED_AS_OF" });
export const assert = (ok, message = "Learning contract validation failed") => { if (!ok) throw new Error(message); };
export const text = (v) => typeof v === "string" && v.trim().length > 0;
export const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const purposeCompatible = (ledgerPurpose, inputPurpose) => PURPOSES.includes(inputPurpose) &&
  (ledgerPurpose === inputPurpose || ledgerPurpose === "AFFILIATE_MONETIZATION" && inputPurpose === "AFFILIATE_NOTE_ACQUISITION");
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const hash = (v) => createHash("sha256").update(typeof v === "string" || Buffer.isBuffer(v) ? v : canonical(v)).digest("hex");
export const POLICY_HASH = hash(POLICY);
export const identifier = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,180}$/.test(v);
export const timestamp = (v, name = "timestamp") => { assertTimestamp(v, name); return new Date(v).toISOString(); };
export const date = (v, name = "date") => { assertDate(v, name); return v; };
export function keys(value, allowed) {
  assert(object(value) && Object.keys(value).every((k) => allowed.includes(k)), "Unknown or invalid contract field");
}
export function strings(v, name = "references") {
  assert(Array.isArray(v) && v.every(text) && new Set(v).size === v.length, `Invalid ${name}`); return v;
}
export function period(v) {
  assert(object(v), "Period required"); date(v.start); date(v.end); assert(v.start <= v.end, "Reversed period"); return v;
}
export function scope(v = {}) {
  keys(v, SCOPE_KEYS);
  const out = Object.fromEntries(SCOPE_KEYS.map((k) => [k, v[k] ?? null]));
  for (const [k, val] of Object.entries(out)) {
    if (val === null) continue;
    if (ARRAY_SCOPES.includes(k)) { strings(val); assert(val.length > 0, "Empty scope is unknown, use null"); out[k] = [...val].sort(); }
    else if (k === "period") period(val);
    else assert(text(val), "Invalid scope value");
  }
  if (out.targetLP) canonicalLP(out.targetLP);
  return out;
}
// Every explicitly claimed dimension must be known and covered by the source.
// Null is never a wildcard or a match, including null against null.
export function scopeCovers(source, requested, ignore = []) {
  return SCOPE_KEYS.filter((k) => requested[k] != null && !ignore.includes(k)).every((k) => {
    if (source[k] == null) return false;
    if (ARRAY_SCOPES.includes(k)) return requested[k].every((v) => source[k].includes(v));
    if (k === "period") return source[k].start <= requested[k].start && source[k].end >= requested[k].end;
    return canonical(source[k]) === canonical(requested[k]);
  });
}
export function seal(collection, payload, recordedAt) {
  assert(COLLECTIONS.includes(collection), "Invalid collection"); timestamp(recordedAt);
  const recordId = `${collection}:${hash(payload)}`;
  return { ...structuredClone(payload), recordId, recordedAt };
}
export function recordPayload(record) {
  const { recordId, recordedAt, ...payload } = record; return payload;
}
export function emptyLedger(purpose = "AFFILIATE_MONETIZATION") {
  assert(PURPOSES.includes(purpose), "Unsupported purpose");
  return { schemaVersion: SCHEMA_VERSION, purpose, ...Object.fromEntries(COLLECTIONS.map((k) => [k, []])) };
}
export function knownAt(record, asOf) {
  const times = [record.recordedAt, record.retrievedAt, record.snapshotAsOf, record.reviewedAt, record.generatedAt, record.verifiedAt].filter(Boolean);
  const days = [record.observedAt, record.effectiveDate, record.observedThrough].filter(Boolean);
  return times.every((v) => Number.isFinite(Date.parse(v)) && Date.parse(v) <= Date.parse(asOf)) &&
    days.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= asOf.slice(0, 10));
}
export function visibleAt(ledger, record, asOf) {
  if (!knownAt(record, asOf)) return false;
  if (!record.sourceRefs) return true;
  return record.sourceRefs.every((ref) => ledger.sourceImports.some((s) => s.sourceId === ref.sourceId && s.sourceType === ref.sourceType &&
    s.recordRefs.includes(record.recordId) && knownAt(s, asOf)));
}
export function validateMetric(m) {
  assert(object(m) && EVIDENCE_TYPES.includes(m.evidenceType) && text(m.availability), "Invalid MetricObservation");
  assert(m.value === null || typeof m.value === "number" && Number.isFinite(m.value) && m.value >= 0, "Invalid metric value");
  assert(m.value === null || ["OBSERVED", "PARTIAL"].includes(m.availability), "Missing metric cannot have value");
  if (m.period) period(m.period);
  for (const k of ["snapshotAsOf", "retrievedAt"]) if (m[k] != null) timestamp(m[k]);
}
export function validateCondition(c) {
  keys(c, ["conditionId", "type", "required", "predicate", "expectedValue", "scope", "evidenceRefs", "reason", "validFrom", "validUntil"]);
  assert(identifier(c.conditionId) && Object.hasOwn(PREDICATES, c.type) && c.predicate === PREDICATES[c.type], "Unsupported retry predicate");
  assert(typeof c.required === "boolean" && text(c.reason), "Retry condition needs reason/required");
  scope(c.scope); strings(c.evidenceRefs); assert(object(c.expectedValue), "Retry expectedValue required");
  const e = c.expectedValue;
  if (c.type === "MEASUREMENT_VERIFIED") { keys(e, []); assert(c.scope.targetLP, "Measurement condition requires LP"); }
  if (c.type === "NEW_EVIDENCE") {
    keys(e, ["metric", "after", "maxAgeDays"]); assert(text(e.metric), "Evidence metric required"); timestamp(e.after);
    if (e.maxAgeDays != null) assert(Number.isInteger(e.maxAgeDays) && e.maxAgeDays >= 0, "Invalid age limit");
  }
  if (c.type === "CHANGED_VARIABLE") {
    keys(e, ["field", "from", "to"]); assert(SCOPE_KEYS.includes(e.field) && !["period", ...ARRAY_SCOPES].includes(e.field), "Unsupported change field");
    assert(text(e.from) && text(e.to) && e.from !== e.to, "Known different values required");
  }
  if (c.type === "OBSERVATION_WINDOW") {
    keys(e, ["endDate", "periodStart", "final"]); date(e.endDate);
    if (e.periodStart) { date(e.periodStart); assert(e.periodStart <= e.endDate, "Reversed window"); }
    assert(typeof e.final === "boolean", "Explicit finality required");
  }
  if (c.type === "REVIEW_CONFIRMATION") { keys(e, ["reviewer"]); assert(text(e.reviewer), "Reviewer required"); }
  if (c.validFrom) timestamp(c.validFrom); if (c.validUntil) timestamp(c.validUntil);
  assert(!c.validFrom || !c.validUntil || Date.parse(c.validFrom) <= Date.parse(c.validUntil), "Reversed validity");
}
export function validateProposal(p) {
  keys(p, ["schemaVersion", "purpose", "proposalId", "isSynthetic", "scope", "relatedExperimentIds", "WHY_REVISIT", "whatChanged", "newEvidenceRefs", "changes", "confirmations", "measurement"]);
  assert(p.schemaVersion === 1 && PURPOSES.includes(p.purpose) && identifier(p.proposalId) && typeof p.isSynthetic === "boolean", "Invalid proposal");
  scope(p.scope); strings(p.relatedExperimentIds ?? []); strings(p.newEvidenceRefs ?? []);
  for (const k of ["WHY_REVISIT", "whatChanged"]) assert(p[k] == null || text(p[k]), "Invalid revisit text");
  assert(Array.isArray(p.changes ?? []) && Array.isArray(p.confirmations ?? []), "Invalid proposal declarations");
  for (const c of p.changes ?? []) {
    keys(c, ["field", "from", "to", "evidenceRefs", "reason"]); assert(SCOPE_KEYS.includes(c.field) && text(c.reason), "Invalid change"); strings(c.evidenceRefs);
  }
  for (const c of p.confirmations ?? []) {
    keys(c, ["conditionId", "reviewedBy", "reviewedAt", "evidenceRefs", "reference", "scope"]);
    assert(identifier(c.conditionId) && text(c.reviewedBy) && text(c.reference), "Invalid confirmation"); timestamp(c.reviewedAt); strings(c.evidenceRefs); scope(c.scope);
  }
  if (p.measurement) {
    keys(p.measurement, ["evidenceRef", "htmlPath", "ga4PropertyReference"]);
    assert(text(p.measurement.evidenceRef) && text(p.measurement.htmlPath) && text(p.measurement.ga4PropertyReference), "Invalid measurement context");
  }
}
