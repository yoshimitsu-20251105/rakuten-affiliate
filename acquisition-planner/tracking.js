import { hash, canonical, slug, ageDays, within, reason } from "./model.js";

export const identityKey = (p) => ({ experimentId: p.experimentId ?? null, candidateId: p.candidateId, channel: p.channel, contentUnit: p.contentUnit ?? null, variant: p.variant ?? null });
export const materialHash = (p) => hash({ key: identityKey(p), targetLP: p.targetLP, protocol: Object.fromEntries(Object.entries(p).filter(([k]) => !["experimentId", "candidateId", "channel", "targetLP"].includes(k))) });
export function identifiers(p, profile, index, registry, asOf) {
  const key = identityKey(p), reasons = [], result = { planId: null, planRevisionIdentity: materialHash(p), identity: key,
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null,
    utmApplicability: profile?.utmApplicable === false ? "NOT_APPLICABLE_ORGANIC" : "NOT_CONFIRMED", plannedAcquisitionURL: null };
  for (const k of ["experimentId", "channel", "contentUnit", "variant"]) {
    if (key[k] == null) reasons.push(reason(`MISSING_${k.toUpperCase()}`, "MANUAL_REVIEW_REQUIRED", "planningContext", `/plan/${k}`));
    else if (!slug(key[k])) reasons.push(reason("INVALID_IDENTIFIER_OR_RESERVED_SEPARATOR", "BLOCKED", "planningContext", `/plan/${k}`));
  }
  if (!reasons.length) {
    result.planId = `plan-${hash(key)}`;
    if (profile?.utmApplicable) {
      result.utm_source = profile.source; result.utm_medium = profile.medium; result.utm_campaign = `amv2__${p.experimentId}__${p.channel}`;
      result.utm_content = `${p.contentUnit}__${p.variant}`; result.utmApplicability = "EXTERNAL_ACQUISITION_LINK_ONLY";
      const url = new URL(p.targetLP); for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) url.searchParams.set(k, result[k]);
      result.plannedAcquisitionURL = url.href;
    } else if (profile?.utmApplicable === false) result.plannedAcquisitionURL = p.targetLP;
  }
  if (registry.items.some((e) => e.experimentId === p.experimentId)) reasons.push(reason("EXISTING_EXPERIMENT_ID_NOT_REPLANNED", "BLOCKED", "current.experimentsSnapshot", "/items"));
  if (index.coverage !== "COMPLETE" || !index.observedAt || index.maxAgeDays == null || ageDays(asOf, index.observedAt) < 0 || ageDays(asOf, index.observedAt) > index.maxAgeDays)
    reasons.push(reason("IDENTITY_COVERAGE_OR_FRESHNESS_UNKNOWN", "MANUAL_REVIEW_REQUIRED", "currentStateManifest", "/identityIndex"));
  for (const e of index.entries) {
    const sameKey = canonical(identityKey(e)) === canonical(key);
    const sameScope = e.experimentId === p.experimentId && e.candidateId === p.candidateId && e.channel === p.channel && e.targetLP === p.targetLP;
    if (e.experimentId === p.experimentId && !sameScope) reasons.push(reason("EXPERIMENT_ID_ASSIGNED_TO_OTHER_SCOPE", "BLOCKED", "currentStateManifest", "/identityIndex/entries"));
    if (sameKey && e.materialHash !== result.planRevisionIdentity) reasons.push(reason("IDENTITY_REUSED_FOR_CHANGED_CONDITIONS", "BLOCKED", "currentStateManifest", "/identityIndex/entries"));
    if (result.utm_campaign && e.utm_campaign === result.utm_campaign && (!sameScope || e.utm_content === result.utm_content && !sameKey))
      reasons.push(reason("UTM_COLLISION", "BLOCKED", "currentStateManifest", "/identityIndex/entries"));
  }
  return { ...result, reasons };
}

const htmlDecode = (s) => s.replace(/&amp;/gi, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
export function linkPresent(html, expected) {
  if (typeof html !== "string") return false;
  // Ignore comments/scripts; only literal anchor hrefs are evidence. No redirect
  // resolution, JS execution, network requests, or inferred tracking parameters.
  const source = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  return [...source.matchAll(/<([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)].some((m) => {
    if (m[1].toLowerCase() !== "a") return false;
    const attrs = [...m[2].matchAll(/(?:^|\s)([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)].filter((a) => a[1].toLowerCase() === "href");
    if (attrs.length !== 1) return false;
    try { return new URL(htmlDecode(attrs[0][2] ?? attrs[0][3] ?? attrs[0][4] ?? "")).href === new URL(expected).href; } catch { return false; }
  });
}
export function measurementBinding(b, p) {
  const { proposedId, binding: binding } = b.planningContext.measurementId, policy = b.planningContext.policy;
  const provider = policy.providerPolicy, html = b.current.html[p.proposalId], currentHash = b.current.measurementContexts[p.proposalId]?.currentPageHash;
  let verified = false;
  if (binding && provider) {
    try {
      const url = new URL(binding.affiliateLink);
      verified = binding.isSynthetic === b.isSynthetic && binding.targetLP === p.targetLP && binding.pageHash === currentHash &&
        binding.accountScopeId === provider.accountScopeId && url.protocol === "https:" && !url.username && !url.password && provider.allowedHostnames.includes(url.hostname) &&
        url.searchParams.getAll(provider.measurementParameter).length === 1 && url.searchParams.get(provider.measurementParameter) === binding.measurementId && linkPresent(html, binding.affiliateLink) &&
        ageDays(b.asOf, binding.confirmedAt) >= 0 && ageDays(b.asOf, binding.confirmedAt) <= policy.maxProofAgeDays &&
        ageDays(b.asOf, provider.confirmedAt) >= 0 && ageDays(b.asOf, provider.confirmedAt) <= policy.maxProofAgeDays && within(binding.validPeriod, b.asOf) && within(provider.validPeriod, b.asOf);
    } catch { verified = false; }
  }
  const state = verified ? "VERIFIED_EXISTING" : proposedId ? "PROPOSED" : "UNKNOWN", reasons = [];
  if (!verified) reasons.push(reason(proposedId ? "MEASUREMENT_ID_PROPOSED_ONLY" : "MEASUREMENT_ID_CONNECTION_UNKNOWN", "MANUAL_REVIEW_REQUIRED", "planningContext", "/measurementId"));
  if (verified && proposedId && proposedId !== binding.measurementId) reasons.push(reason("TRACKING_CHANGE_REQUIRED", "BLOCKED", "planningContext", "/measurementId/proposedId"));
  const plan = b.planningContext.plan;
  if (verified && plan?.attributionScope === "EXPERIMENT_CHANNEL" && (binding.exclusivity !== "EXPERIMENT_CHANNEL" || binding.experimentId !== plan.experimentId || binding.candidateId !== p.candidateId || binding.channel !== p.channel))
    reasons.push(reason("CHANNEL_REVENUE_BINDING_NOT_EXCLUSIVE", "BLOCKED", "planningContext", "/measurementId/binding"));
  if (verified && binding.exclusivity === "EXPERIMENT_CHANNEL") {
    for (const e of b.currentStateManifest.identityIndex.entries) if (e.accountScopeId === binding.accountScopeId && e.affiliateMeasurementId === binding.measurementId &&
      (e.experimentId !== plan?.experimentId || e.candidateId !== p.candidateId || e.channel !== p.channel))
      reasons.push(reason("MEASUREMENT_ID_ASSIGNMENT_CONFLICT", "BLOCKED", "currentStateManifest", "/identityIndex/entries"));
  }
  const snapshot = b.orderSnapshot;
  const observed = verified && snapshot && !snapshot.batch.isSynthetic && !b.isSynthetic && snapshot.batch.accountScopeId === binding.accountScopeId &&
    snapshot.batch.coverage === "COMPLETE" && binding.validPeriod.start <= snapshot.batch.periodStart && binding.validPeriod.end >= snapshot.batch.periodEnd ?
    snapshot.records.filter((r) => r.measurementId === binding.measurementId) : [];
  return { affiliateMeasurementIdStatus: state, affiliateMeasurementId: verified ? binding.measurementId : null, proposedAffiliateMeasurementId: proposedId ?? null,
    measurementIdBinding: binding ? { ...binding, verifiedAtPlanAsOf: verified, verificationScope: "SAVED_HTML_AND_EXPLICIT_PROVIDER_POLICY_NOT_LIVE_REQUEST" } : null,
    attributionEvidenceType: observed.length ? "FACT" : "UNKNOWN", attributionEvidenceStatus: observed.length ? "CSV_ID_AND_LINK_OBSERVED" : "NO_MATCHING_CSV_ID_AND_VERIFIED_LINK",
    observedRevenueEvidence: { measurementId: observed.length ? binding.measurementId : null, evidenceType: observed.length ? "FACT" : "UNKNOWN",
      scope: "OBSERVED_MEASUREMENT_ID_ONLY", accountScopeId: observed.length ? snapshot.batch.accountScopeId : null,
      sourceFileHash: observed.length ? snapshot.batch.sourceFileHash : null, period: snapshot ? { start: snapshot.batch.periodStart, end: snapshot.batch.periodEnd } : null,
      snapshotAsOf: snapshot?.batch.snapshotAsOf ?? null, retrievedAt: snapshot?.batch.retrievedAt ?? null,
      sourceBatch: snapshot ? Object.fromEntries(["importId", "sourceFileHash", "recordCount", "resultType", "periodStatus", "observedThrough", "currency", "timezone", "dateBasis", "grain", "coverage", "conversionValidationStatus", "nonZeroRealDataVerified"].map((k) => [k, snapshot.batch[k]])) : null,
      records: observed.length ? observed.map((r) => ({ ...r })) : null, revenue: null, approvedRevenue: null, conversions: null, epc: null,
      channelRevenue: null, experimentRevenue: null, missingReason: observed.length ? "PLANNER_DOES_NOT_AGGREGATE_OR_ALLOCATE" : "NO_MATCHING_CSV_ID_AND_VERIFIED_LINK" }, reasons };
}
