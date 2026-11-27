import { assert, timestamp } from "../market-scanner/model.js";
import { MAX_SCORES, POLICY_HASH } from "../opportunity-scorer/policy.js";

const DAY = 86_400_000;
const directions = ["UP", "FLAT", "DOWN"];
const types = ["FACT", "ESTIMATE", "HYPOTHESIS"];
const providers = ["google-trends", "search-console", "public-market", "rakuten"];
const text = (value) => typeof value === "string" && value.trim().length > 0;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function normalize(signal, synthetic) {
  assert(signal && text(signal.source) && text(signal.sourceRef) && types.includes(signal.evidenceType), "Invalid signal provenance");
  const { source, sourceRef, evidenceType, previous, current, scannerEvidenceRef = null } = signal;
  const observedAt = timestamp(signal.observedAt, "signal observedAt");
  assert(typeof synthetic === "boolean" && (!synthetic || evidenceType !== "FACT"), "Synthetic signals require ESTIMATE or HYPOTHESIS");
  for (const value of [previous, current]) assert(value === null || Number.isFinite(value) && value >= 0, "Signal values require non-negative numbers or null");
  assert(scannerEvidenceRef === null || text(scannerEvidenceRef), "Invalid scanner evidence reference");
  return { source, sourceRef, evidenceType, observedAt, previous, current, scannerEvidenceRef, isSynthetic: synthetic };
}

// Providers return normalized comparable period pairs. Availability is reported separately from values.
export async function collectRadarSignals(provider, query) {
  assert(providers.includes(provider?.id) && typeof provider.requiresCredentials === "boolean" &&
    typeof provider.isSynthetic === "boolean" && typeof provider.read === "function", "Invalid Radar provider");
  if (provider.requiresCredentials && provider.hasCredentials !== true) {
    return { provider: provider.id, status: "NOT_AVAILABLE", reason: "CREDENTIALS_ABSENT", signals: [] };
  }
  const rows = await provider.read(query);
  assert(Array.isArray(rows), "Provider must return an array");
  return { provider: provider.id, status: rows.length ? "AVAILABLE" : "UNKNOWN",
    reason: rows.length ? null : "NO_OBSERVATIONS",
    signals: rows.map((row) => normalize({ ...row, source: provider.id }, provider.isSynthetic)) };
}

export function buildRadar(input) {
  assert(input?.schemaVersion === 1 && Array.isArray(input.candidates), "Invalid Radar input");
  const asOf = timestamp(input.asOf, "Radar asOf");
  const now = Date.parse(asOf);
  const maxAgeDays = input.maxAgeDays ?? 14;
  assert(Number.isInteger(maxAgeDays) && maxAgeDays > 0 && maxAgeDays <= 365, "Invalid maximum age");
  const ids = new Set();
  const opportunities = input.candidates.map((c) => {
    assert(c && /^[A-Za-z0-9_-]+$/.test(c.opportunityId ?? "") && !ids.has(c.opportunityId) &&
      text(c.topic) && text(c.category) && Array.isArray(c.keywords) && c.keywords.length && c.keywords.every(text) &&
      typeof c.isSynthetic === "boolean" && Array.isArray(c.signals), "Invalid Radar candidate");
    ids.add(c.opportunityId);
    const observed = timestamp(c.observedAt, "candidate observedAt");
    assert(Date.parse(observed) <= now, "Candidate observed in the future");
    const evidence = c.signals.map((s) => normalize(s, c.isSynthetic))
      .filter((s) => Date.parse(s.observedAt) <= now)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || order(JSON.stringify(a), JSON.stringify(b)));
    const freshest = evidence[0]?.observedAt ?? observed;
    const expiresAt = new Date(Date.parse(freshest) + maxAgeDays * DAY).toISOString();
    const freshness = now >= Date.parse(expiresAt) ? "EXPIRED" : "FRESH";
    const comparable = evidence.filter((s) => now < Date.parse(s.observedAt) + maxAgeDays * DAY &&
      s.previous !== null && s.current !== null);
    const latestBySource = new Map();
    for (const s of comparable) {
      const key = s.source;
      if (!latestBySource.has(key) || latestBySource.get(key)[0].observedAt === s.observedAt) {
        latestBySource.set(key, [...(latestBySource.get(key) ?? []), s]);
      }
    }
    const latest = [...latestBySource.values()].flat();
    const observedDirections = new Set(latest.map((s) => s.current > s.previous ? "UP" : s.current < s.previous ? "DOWN" : "FLAT"));
    const demandDirection = observedDirections.size === 1 ? [...observedDirections][0] : "UNKNOWN";
    const seasonality = c.seasonality == null ? { peakMonths: [], evidenceType: "UNKNOWN", sourceRef: null } : c.seasonality;
    assert(Array.isArray(seasonality.peakMonths) && seasonality.peakMonths.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) &&
      (c.seasonality == null || text(seasonality.sourceRef) && types.includes(seasonality.evidenceType) &&
        (!c.isSynthetic || seasonality.evidenceType !== "FACT")), "Invalid seasonality evidence");
    return {
      opportunityId: c.opportunityId, scannerCandidateId: c.scannerCandidateId ?? null,
      topic: c.topic, category: c.category, keywords: [...new Set(c.keywords)].sort(order), isSynthetic: c.isSynthetic,
      demandDirection,
      seasonality: { peakMonths: [...new Set(seasonality.peakMonths)].sort((a, b) => a - b),
        evidenceType: seasonality.evidenceType, sourceRef: seasonality.sourceRef },
      commercialIntent: c.commercialIntent ?? null, freshness, competitionEstimate: c.competitionEstimate ?? null,
      confidence: demandDirection === "UNKNOWN" ? null : latestBySource.size >= 2 ? "CORROBORATED" : "SINGLE_SOURCE",
      observedAt: freshest, expiresAt, evidence,
      demandEvidence: demandDirection === "UNKNOWN" ? [] : latest,
      reasonToTestNow: freshness === "EXPIRED" ? "Re-evaluate with current evidence" :
        demandDirection === "UP" ? "Comparable recent periods show rising demand" : "No rising demand established",
    };
  });
  const priority = { UP: 0, FLAT: 1, UNKNOWN: 2, DOWN: 3 };
  opportunities.sort((a, b) => Number(a.freshness === "EXPIRED") - Number(b.freshness === "EXPIRED") ||
    priority[a.demandDirection] - priority[b.demandDirection] || order(a.opportunityId, b.opportunityId));
  return { schemaVersion: 1, asOf, opportunities };
}

// Adapt linked Scanner evidence into a Scorer assessment context without editing policy.
export function radarScorerContext(scanner, radar) {
  assert(timestamp(scanner.asOf, "Scanner asOf") === radar.asOf, "Scanner and Radar asOf must match");
  const assessments = radar.opportunities.flatMap((opportunity) => {
    const candidate = scanner.candidates.find((c) => c.candidateId === opportunity.scannerCandidateId);
    if (!candidate) return [];
    assert(candidate.isSynthetic === opportunity.isSynthetic, "Radar and Scanner synthetic scope mismatch");
    const linked = opportunity.demandEvidence.filter((signal) =>
      candidate.demandEvidence.includes(signal.scannerEvidenceRef) && scanner.evidence.some((e) =>
        e.evidenceId === signal.scannerEvidenceRef && e.isSynthetic === candidate.isSynthetic &&
        e.value === signal.current && e.provider === signal.source && e.evidenceType === signal.evidenceType &&
        Date.parse(e.retrievedAt) === Date.parse(signal.observedAt)));
    const evidenceRefs = [...new Set(linked.map((signal) => signal.scannerEvidenceRef))];
    const known = linked.length > 0 && linked.length === opportunity.demandEvidence.length &&
      opportunity.freshness === "FRESH" && directions.includes(opportunity.demandDirection);
    const factor = { UP: 1, FLAT: 0.5, DOWN: 0 };
    return [{ candidateId: candidate.candidateId, contextId: opportunity.opportunityId, isSynthetic: candidate.isSynthetic,
      assessedAt: radar.asOf, assessedBy: "trend-demand-radar-v1",
      applicablePeriod: { start: radar.asOf.slice(0, 10), end: radar.asOf.slice(0, 10) },
      components: { demand: { maxScore: MAX_SCORES.demand,
        value: known ? MAX_SCORES.demand * factor[opportunity.demandDirection] : null,
        evidenceType: known ? "HYPOTHESIS" : "UNKNOWN", evidenceRefs: known ? evidenceRefs : [],
        reason: known ? "Radar direction from recent comparable observations" : "No current linked demand evidence" } } }];
  });
  return { schemaVersion: 1, purpose: "AFFILIATE_MONETIZATION", scannerRunId: scanner.runId, policyHash: POLICY_HASH, assessments };
}
