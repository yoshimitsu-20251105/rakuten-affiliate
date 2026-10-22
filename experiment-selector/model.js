import { assert, object, text, keys, strings, timestamp, date, period, scope, canonicalLP, hash, canonical, identifier } from "../learning-engine/model.js";
import { validateProposal as validateLearningProposal } from "../learning-engine/model.js";
import { TRACKS, POLICY, POLICY_HASH, REVENUE_CLASSES, NON_REVENUE_CLASSES, GROUP } from "./policy.js";
export { assert, object, text, keys, strings, timestamp, date, period, scope, canonicalLP, hash, canonical, identifier };
export const OUTPUT_TYPE = "EXPERIMENT_SELECTION_RECOMMENDATION_ONLY";
export const INPUTS = ["scannerReport", "scorerReport", "learningReport", "learningLedger", "experimentsSnapshot", "selectionContext"];
export const purpose = (p) => ["AFFILIATE_MONETIZATION", "AFFILIATE_NOTE_ACQUISITION"].includes(p);
export const evidenceRef = (inputs, sourceId, jsonPointer, evidenceType = "FACT") => ({ sourceId, sourceFileHash: inputs.hashes[sourceId], jsonPointer, evidenceType });

export function pointer(value, path) {
  assert(typeof path === "string" && path.startsWith("/"), "Invalid JSON pointer");
  let current = value;
  for (const part of path.slice(1).split("/").map((v) => v.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    assert(!["__proto__", "constructor", "prototype"].includes(part) && current != null && Object.hasOwn(current, part), "Unresolved reference"); current = current[part];
  }
  return current;
}
export function validateManifest(m) {
  keys(m, ["schemaVersion", "purpose", "isSynthetic", "inputs"]);
  assert(m.schemaVersion === 1 && purpose(m.purpose) && typeof m.isSynthetic === "boolean", "Invalid manifest"); keys(m.inputs, INPUTS);
  for (const name of INPUTS) {
    const file = m.inputs[name]; keys(file, ["path", "sha256"]); assert(text(file.path), "Missing explicit input path");
    if (file.sha256 != null) assert(/^[a-f0-9]{64}$/.test(file.sha256), "Invalid expected hash");
  }
}
export function validatePolicy(p) {
  keys(p, ["policyId", "version", "policyHash", "selectionTrack", "selectionScope", "comparisonGroup", "maxConcurrentMonetizationExperiments",
    "monetizationGroups", "configuredBy", "configuredAt", "confirmationReference", "applicablePeriod", "maxSnapshotAgeDays"]);
  assert(identifier(p.policyId) && p.version === POLICY.version && p.policyHash === POLICY_HASH && TRACKS.includes(p.selectionTrack), "Unsupported selection policy");
  assert(text(p.configuredBy) && text(p.confirmationReference), "Policy attribution required"); timestamp(p.configuredAt); period(p.applicablePeriod);
  assert(Number.isInteger(p.maxSnapshotAgeDays) && p.maxSnapshotAgeDays >= 0, "Explicit snapshot age required");
  const limit = p.maxConcurrentMonetizationExperiments;
  assert(limit == null || Number.isInteger(limit) && limit >= 0, "Invalid concurrency limit");
  strings(p.monetizationGroups); assert(p.monetizationGroups.length > 0, "Declared groups required");
  if (p.comparisonGroup != null) assert(/^[a-f0-9]{64}$/.test(p.comparisonGroup), "Invalid comparison group");
  keys(p.selectionScope, ["candidateIds", "channel", "purpose", "reason"]);
  strings(p.selectionScope.candidateIds); assert(text(p.selectionScope.reason), "Scope reason required");
  assert(p.selectionScope.channel == null || text(p.selectionScope.channel), "Invalid channel scope");
  assert(p.selectionScope.purpose == null || purpose(p.selectionScope.purpose), "Invalid purpose scope");
}
export function learningProposal(p, isSynthetic) {
  return { schemaVersion: 1, purpose: p.purpose, proposalId: p.proposalId, isSynthetic, scope: p.scope,
    relatedExperimentIds: p.relatedExperimentIds, WHY_REVISIT: p.WHY_REVISIT ?? null, whatChanged: p.whatChanged ?? null,
    newEvidenceRefs: p.newEvidenceRefs ?? [], changes: p.changes ?? [], confirmations: p.confirmations ?? [], ...(p.measurement ? { measurement: p.measurement } : {}) };
}
export function validateContext(c, isSynthetic) {
  keys(c, ["schemaVersion", "purpose", "isSynthetic", "policy", "registry", "experimentClassifications", "proposals"]);
  assert(c.schemaVersion === 1 && purpose(c.purpose) && c.isSynthetic === isSynthetic, "Invalid selection context"); validatePolicy(c.policy);
  keys(c.registry, ["sourceFileHash", "coverage", "scope", "observedAt", "sourceReference", "maxAgeDays"]);
  assert(/^[a-f0-9]{64}$/.test(c.registry.sourceFileHash) && ["COMPLETE", "UNKNOWN"].includes(c.registry.coverage) &&
    c.registry.scope === "ALL_REGISTERED_AFFILIATE_EXPERIMENTS" && text(c.registry.sourceReference), "Invalid registry confirmation");
  if (c.registry.observedAt != null) timestamp(c.registry.observedAt);
  assert(c.registry.maxAgeDays == null || Number.isInteger(c.registry.maxAgeDays) && c.registry.maxAgeDays >= 0, "Invalid registry freshness policy");
  assert(Array.isArray(c.experimentClassifications) && Array.isArray(c.proposals), "Invalid context collections");
  const classIds = new Set();
  for (const r of c.experimentClassifications) {
    keys(r, ["experimentId", "experimentClass", "monetizationGroup", "recordHash", "evidencePointers", "reason", "reviewedBy", "reviewedAt", "confirmationReference"]);
    assert(identifier(r.experimentId) && !classIds.has(r.experimentId) && [...REVENUE_CLASSES, ...NON_REVENUE_CLASSES, "UNKNOWN"].includes(r.experimentClass), "Invalid classification"); classIds.add(r.experimentId);
    assert(/^[a-f0-9]{64}$/.test(r.recordHash) && text(r.reason) && text(r.reviewedBy) && text(r.confirmationReference), "Classification evidence required"); timestamp(r.reviewedAt); strings(r.evidencePointers);
    assert(r.experimentClass === "UNKNOWN" || r.evidencePointers.length > 0, "Classification source pointers required");
    if (REVENUE_CLASSES.includes(r.experimentClass)) assert(c.policy.monetizationGroups.includes(r.monetizationGroup), "Undeclared revenue group");
    else assert(r.monetizationGroup == null, "Non-revenue class cannot claim revenue group");
  }
  const ids = new Set();
  for (const p of c.proposals) {
    keys(p, ["proposalId", "candidateId", "assessmentId", "contextId", "purpose", "experimentClass", "monetizationGroup", "channel", "targetLP", "itemCodes", "scope",
      "hypothesis", "falsificationCondition", "primaryMetric", "successCondition", "reviewCondition", "measurementPlan", "variables", "relatedExperimentIds",
      "WHY_REVISIT", "whatChanged", "newEvidenceRefs", "changes", "confirmations", "measurement", "historyReview", "referencePerformanceScope"]);
    assert(identifier(p.proposalId) && !ids.has(p.proposalId) && text(p.candidateId) && text(p.assessmentId) && text(p.contextId) && purpose(p.purpose), "Invalid proposal identity"); ids.add(p.proposalId);
    assert(REVENUE_CLASSES.includes(p.experimentClass) && c.policy.monetizationGroups.includes(p.monetizationGroup), "Monetization proposal class/group required");
    assert(p.purpose !== "AFFILIATE_NOTE_ACQUISITION" || p.experimentClass === "AFFILIATE_NOTE_ACQUISITION" && p.channel === "note", "Affiliate note class mismatch");
    assert(p.experimentClass !== "AFFILIATE_NOTE_ACQUISITION" || p.purpose === "AFFILIATE_NOTE_ACQUISITION", "Affiliate note class requires note purpose");
    assert(p.channel !== "note" || p.purpose === "AFFILIATE_NOTE_ACQUISITION", "Note cannot bypass note purpose");
    assert(text(p.channel), "Proposal channel required"); canonicalLP(p.targetLP); strings(p.itemCodes); scope(p.scope);
    assert(p.scope.targetLP === p.targetLP && p.scope.channel === p.channel, "Proposal LP/channel scope mismatch");
    for (const k of ["hypothesis", "falsificationCondition", "primaryMetric", "successCondition", "reviewCondition", "measurementPlan"]) assert(text(p[k]), "Explicit test definition required");
    assert(object(p.variables), "Variables required"); strings(p.relatedExperimentIds); validateLearningProposal(learningProposal(p, isSynthetic));
    if (p.referencePerformanceScope != null) scope(p.referencePerformanceScope);
    if (p.historyReview != null) {
      keys(p.historyReview, ["counterEvidenceHashes", "reviewedBy", "reviewedAt", "reason"]); strings(p.historyReview.counterEvidenceHashes);
      assert(text(p.historyReview.reviewedBy) && text(p.historyReview.reason), "Explicit counter evidence review required"); timestamp(p.historyReview.reviewedAt);
    }
  }
}
export function defaultGroupForClass(experimentClass) { return REVENUE_CLASSES.includes(experimentClass) ? GROUP : null; }
