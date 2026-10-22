import { assert, object, text, keys, strings, timestamp, period, canonicalLP, hash, canonical, identifier } from "../learning-engine/model.js";
export { assert, object, text, keys, strings, timestamp, period, canonicalLP, hash, canonical, identifier };
export const OUTPUT_TYPE = "ACQUISITION_PLAN_ONLY";
export const PURPOSES = ["AFFILIATE_MONETIZATION", "AFFILIATE_NOTE_ACQUISITION"];
export const OPERATIONS = Object.freeze({ canStartExperiment: false, canPublish: false, canPost: false, canModifyLP: false,
  canModifyCTA: false, canModifyAffiliateUrl: false, canModifyTracking: false });
export const POLICY = Object.freeze({ version: "acquisition-planner-v1", maxPlans: 1, measurementIdStates: ["VERIFIED_EXISTING", "PROPOSED", "UNKNOWN"],
  states: ["READY", "BLOCKED", "MANUAL_REVIEW_REQUIRED"], implicitReselection: false, automaticActions: false, revenueAllocation: false });
export const POLICY_HASH = hash(POLICY);
export const ROOT_INPUTS = ["selectorReport", "selectorInputManifest", "currentStateManifest", "planningContext"];
export const CURRENT_INPUTS = ["experimentsSnapshot", "learningLedger", "selectionContext"];
export const PROTOCOL_FIELDS = ["contentUnit", "variant", "contentPurpose", "contentPattern", "titlePattern", "ctaPattern", "fixedVariables", "changedVariable", "requiredMetrics", "requiredTrafficGrain", "attributionScope"];
export const slug = (v) => typeof v === "string" && /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(v);
export const sha256 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function fileSpec(v, requiredHash = false) {
  keys(v, ["path", "sha256"]); assert(text(v.path) && (!requiredHash && v.sha256 == null || sha256(v.sha256)), "Explicit path/hash required");
}
export function validateManifest(m) {
  keys(m, ["schemaVersion", "purpose", "isSynthetic", "inputs"]);
  assert(m.schemaVersion === 1 && PURPOSES.includes(m.purpose) && typeof m.isSynthetic === "boolean", "Unsupported Affiliate manifest");
  keys(m.inputs, ROOT_INPUTS); for (const name of ROOT_INPUTS) fileSpec(m.inputs[name], name === "selectorReport");
}
export function validateHTMLRows(rows) {
  assert(Array.isArray(rows), "HTML snapshot collection required"); const seen = new Set();
  for (const r of rows) {
    keys(r, ["proposalId", "targetLP", "path", "sha256"]); assert(identifier(r.proposalId) && !seen.has(r.proposalId) && text(r.path), "Invalid/duplicate HTML reference");
    seen.add(r.proposalId); canonicalLP(r.targetLP); if (r.sha256 != null) assert(sha256(r.sha256), "Invalid HTML hash");
  }
}
export function validateCurrentManifest(m, synthetic) {
  keys(m, ["schemaVersion", "purpose", "isSynthetic", "inputs", "htmlSnapshots", "identityIndex", "orderEvidence"]);
  assert(m.schemaVersion === 1 && PURPOSES.includes(m.purpose) && m.isSynthetic === synthetic, "Current state purpose/synthetic mismatch");
  keys(m.inputs, CURRENT_INPUTS); CURRENT_INPUTS.forEach((k) => fileSpec(m.inputs[k])); validateHTMLRows(m.htmlSnapshots);
  const i = m.identityIndex;
  keys(i, ["coverage", "scope", "observedAt", "maxAgeDays", "sourceReference", "entries"]);
  assert(["COMPLETE", "UNKNOWN"].includes(i.coverage) && i.scope === "KNOWN_AFFILIATE_IDENTIFIERS" && text(i.sourceReference) && Array.isArray(i.entries), "Identity coverage required");
  if (i.observedAt != null) timestamp(i.observedAt);
  assert(i.maxAgeDays == null || Number.isInteger(i.maxAgeDays) && i.maxAgeDays >= 0, "Invalid identity age policy");
  for (const e of i.entries) {
    keys(e, ["experimentId", "candidateId", "channel", "contentUnit", "variant", "targetLP", "utm_campaign", "utm_content", "accountScopeId", "affiliateMeasurementId", "materialHash"]);
    for (const k of ["experimentId", "candidateId", "channel", "contentUnit", "variant"]) assert(text(e[k]), "Incomplete known identity");
    canonicalLP(e.targetLP); for (const k of ["utm_campaign", "utm_content", "accountScopeId", "affiliateMeasurementId"]) assert(e[k] == null || text(e[k]), "Invalid identity assignment");
    assert(sha256(e.materialHash), "Known identity requires material hash");
  }
  if (m.orderEvidence != null) { keys(m.orderEvidence, ["csv", "metadata"]); fileSpec(m.orderEvidence.csv, true); fileSpec(m.orderEvidence.metadata); }
}
export function validateContext(c, synthetic) {
  keys(c, ["schemaVersion", "purpose", "isSynthetic", "policy", "selectedProposalId", "plan", "measurementId", "channelProfiles", "checklistConfirmations"]);
  assert(c.schemaVersion === 1 && PURPOSES.includes(c.purpose) && c.isSynthetic === synthetic, "Unsupported planning purpose");
  const p = c.policy; keys(p, ["policyId", "version", "policyHash", "configuredBy", "configuredAt", "confirmationReference", "applicablePeriod", "maxSelectorAgeDays", "maxProofAgeDays", "providerPolicy"]);
  assert(identifier(p.policyId) && p.version === POLICY.version && p.policyHash === POLICY_HASH && text(p.configuredBy) && text(p.confirmationReference), "Unsupported planning policy");
  timestamp(p.configuredAt); period(p.applicablePeriod);
  for (const k of ["maxSelectorAgeDays", "maxProofAgeDays"]) assert(Number.isInteger(p[k]) && p[k] >= 0, "Explicit age policy required");
  if (p.providerPolicy != null) {
    const r = p.providerPolicy; keys(r, ["accountScopeId", "measurementParameter", "allowedHostnames", "confirmedBy", "confirmedAt", "evidenceReference", "validPeriod"]);
    assert(text(r.accountScopeId) && text(r.measurementParameter) && /^[a-zA-Z0-9_]+$/.test(r.measurementParameter) && text(r.confirmedBy) && text(r.evidenceReference), "Provider policy proof required");
    strings(r.allowedHostnames); assert(r.allowedHostnames.length && r.allowedHostnames.every((h) => /^(?:[a-z0-9-]+\.)*afl\.rakuten\.co\.jp$/.test(h)), "Only explicit Rakuten affiliate hosts supported");
    timestamp(r.confirmedAt); period(r.validPeriod);
  }
  assert(c.selectedProposalId == null || identifier(c.selectedProposalId), "Invalid proposal reference");
  if (c.plan != null) {
    keys(c.plan, ["experimentId", "candidateId", "channel", "targetLP", ...PROTOCOL_FIELDS]);
    assert(c.plan.experimentId == null || text(c.plan.experimentId), "Invalid proposed experiment ID");
    for (const k of ["candidateId", "channel", "targetLP"]) assert(text(c.plan[k]), "Explicit selected scope required"); canonicalLP(c.plan.targetLP);
    for (const k of ["contentUnit", "variant", "contentPurpose", "contentPattern", "titlePattern", "ctaPattern"]) assert(c.plan[k] == null || text(c.plan[k]), "Invalid plan metadata");
    assert(c.plan.fixedVariables == null || object(c.plan.fixedVariables), "Invalid fixed variables");
    if (c.plan.changedVariable != null) { keys(c.plan.changedVariable, ["name", "from", "to", "reason"]); assert(text(c.plan.changedVariable.reason), "Variable reason required"); }
    strings(c.plan.requiredMetrics ?? []);
    assert(c.plan.requiredTrafficGrain == null || ["CAMPAIGN_CONTENT", "ORGANIC_PAGE_PERIOD"].includes(c.plan.requiredTrafficGrain), "Unsupported traffic grain");
    assert(c.plan.attributionScope == null || ["MEASUREMENT_ID_ONLY", "EXPERIMENT_CHANNEL", "LP_ONLY"].includes(c.plan.attributionScope), "Unsupported attribution scope");
  }
  keys(c.measurementId, ["proposedId", "binding"]);
  assert(c.measurementId.proposedId == null || text(c.measurementId.proposedId), "Invalid proposed measurement ID");
  if (c.measurementId.binding != null) {
    const b = c.measurementId.binding;
    keys(b, ["measurementId", "accountScopeId", "experimentId", "candidateId", "channel", "targetLP", "pageHash", "affiliateLink", "confirmedBy", "confirmedAt", "validPeriod", "exclusivity", "evidenceReference", "isSynthetic"]);
    assert(text(b.measurementId) && text(b.accountScopeId) && typeof b.isSynthetic === "boolean", "Invalid link binding");
    canonicalLP(b.targetLP); timestamp(b.confirmedAt); period(b.validPeriod);
    assert(sha256(b.pageHash) && text(b.affiliateLink) && text(b.confirmedBy) && text(b.evidenceReference) && ["EXPERIMENT_CHANNEL", "SHARED", "UNKNOWN"].includes(b.exclusivity), "Incomplete binding proof");
  }
  assert(Array.isArray(c.channelProfiles) && Array.isArray(c.checklistConfirmations), "Profile/checklist collections required");
  const ids = new Set();
  for (const r of c.checklistConfirmations) {
    keys(r, ["checkId", "status", "targetLP", "channel", "pageHash", "proposalId", "policyHash", "reviewedBy", "reviewedAt", "sourceReference"]);
    assert(["TRAFFIC_GRAIN", "CHANNEL_HANDOFF"].includes(r.checkId) && !ids.has(r.checkId) && ["PASS", "FAIL", "UNKNOWN"].includes(r.status), "Invalid/duplicate confirmation"); ids.add(r.checkId);
    canonicalLP(r.targetLP); timestamp(r.reviewedAt); assert(sha256(r.pageHash) && sha256(r.policyHash) && text(r.reviewedBy) && text(r.sourceReference) && text(r.channel) && identifier(r.proposalId), "Scoped confirmation required");
  }
}
export const ageDays = (at, before) => (Date.parse(at) - Date.parse(before)) / 86400000;
export const within = (p, at) => p && p.start <= at.slice(0, 10) && p.end >= at.slice(0, 10);
export const reason = (code, status, sourceId, jsonPointer, detail = null) => ({ code, status, sourceId, jsonPointer, detail });
export const statusFor = (reasons) => reasons.some((r) => r.status === "BLOCKED") ? "BLOCKED" : reasons.length ? "MANUAL_REVIEW_REQUIRED" : "READY";
export const ref = (bundle, sourceId, jsonPointer, evidenceType = "FACT") => ({ sourceId, sourceFileHash: bundle.hashes[sourceId], jsonPointer, evidenceType });
