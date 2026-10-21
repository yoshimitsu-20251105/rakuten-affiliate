import { normalizeKeyword } from "../keyword-research/normalize.js";
import { classifyIntent } from "../keyword-research/intent.js";
import { extractAttributes } from "../keyword-research/attributes.js";
import { classifySafety } from "../keyword-research/safety.js";
import { classifyQueryQuality } from "../keyword-research/query-quality.js";
import { INTENT_KEYWORDS, MEDICAL_TERMS, HEALTH_TERMS, QUERY_QUALITY_RULES } from "../keyword-research/config.js";
import { assert, date, timestamp, hash, phrase, evidence, freshness, unknown, numberOrNull } from "./model.js";

const RULES = { intentKeywords: INTENT_KEYWORDS, medicalTerms: MEDICAL_TERMS, healthTerms: HEALTH_TERMS, queryQualityRules: QUERY_QUALITY_RULES };
const PURCHASE = new Set(["EXACT_PRODUCT", "CONDITION_PURCHASE", "COMMERCIAL_COMPARISON"]);

export function matchingLinks(seed, manifest) {
  return (manifest.links ?? []).filter((link) => {
    if (link.country && link.country !== seed.country) return false;
    if (link.language && link.language !== seed.language) return false;
    return seed.opportunityId ? link.opportunityId === seed.opportunityId : typeof link.keyword === "string" && phrase(link.keyword) === phrase(seed.keyword);
  });
}

function recordSource(source, row, manifest, asOf) {
  const s = { ...source };
  for (const key of ["country", "language", "timezone", "periodStart", "periodEnd", "grain"]) if (row[key]) s[key] = row[key];
  if (row.sourceProvider) s.provider = row.sourceProvider;
  if (row.retrievedAt) s.retrievedAt = timestamp(row.retrievedAt, "record retrievedAt");
  if (row.isSynthetic !== undefined && row.isSynthetic !== "") {
    assert([true, false, "true", "false"].includes(row.isSynthetic), "record isSyntheticが不正です");
    s.isSynthetic = source.isSynthetic || row.isSynthetic === true || row.isSynthetic === "true";
  }
  for (const key of ["periodStart", "periodEnd"]) if (s[key]) date(s[key], `record ${key}`);
  assert(!(s.periodStart && s.periodEnd) || s.periodStart <= s.periodEnd, "record期間が逆です");
  s.freshness = freshness(s, asOf, manifest.freshnessPolicy?.[source.sourceId] ?? {});
  return s;
}

/** Pure assembly: evidence lists, never scores or a ranking. */
export function assembleCandidates(sources, manifest, { asOf }) {
  const candidates = new Map(), evidenceMap = new Map();
  function register(item) {
    const existing = evidenceMap.get(item.evidenceId);
    if (!existing) evidenceMap.set(item.evidenceId, item);
    else if (existing.sourceId !== item.sourceId || existing.sourceFileHash !== item.sourceFileHash) {
      existing.additionalSources ??= [];
      const ref = { sourceId: item.sourceId, sourceReference: item.sourceReference, sourceFileHash: item.sourceFileHash, sourceRecordReference: item.sourceRecordReference };
      if (!existing.additionalSources.some((r) => hash(r) === hash(ref))) existing.additionalSources.push(ref);
    }
    return item.evidenceId;
  }
  for (const source of sources) {
    const seeds = source.sourceType === "opportunities" ? source.rows.map((row) => ({ ...row, keyword: row.name, opportunityId: row.id })) : source.observations;
    for (const row of seeds) {
      const s = recordSource(source, row, manifest, asOf);
      let seed = { ...row, country: s.country, language: s.language };
      const links = matchingLinks(seed, manifest);
      const keys = [...new Set(links.map((l) => l.opportunityId ?? l.marketId).filter(Boolean))];
      assert(keys.length <= 1, "keywordに複数市場のmappingがあります。勝手に統合しません");
      const linkedKeyword = row.opportunityId ? links.find((l) => l.keyword)?.keyword : null;
      const original = linkedKeyword ?? row.keyword;
      const normalized = normalizeKeyword(original);
      const intentResult = classifyIntent(phrase(original), RULES);
      const fallbackIntent = intentResult.reasons.some((r) => r.includes("フォールバック"));
      const intent = fallbackIntent ? null : intentResult.intent;
      const attributes = extractAttributes(normalized.canonicalKeyword).sort();
      const key = { market: keys[0] ?? row.opportunityId ?? phrase(original), intent, attributes, country: s.country, language: s.language, isSynthetic: s.isSynthetic };
      const id = hash(key);
      let c = candidates.get(id);
      if (!c) {
        const theme = links.find((l) => l.theme)?.theme ?? (row.opportunityId ? row.name : original);
        c = {
          candidateId: id, schemaVersion: 1, outputType: "MARKET_CANDIDATES_ONLY", country: s.country, language: s.language, isSynthetic: s.isSynthetic,
          theme: { value: theme, evidenceType: row.opportunityId && theme === row.name ? "FACT" : "HYPOTHESIS", reason: row.opportunityId && theme === row.name ? "EXISTING_OPPORTUNITY_LABEL" : "PROVISIONAL_QUERY_THEME", evidenceRefs: [] },
          keywords: [], intent: { value: intent, evidenceType: intent ? "HYPOTHESIS" : "UNKNOWN", ruleVersion: "existing-intent-rules-v1", reasons: intentResult.reasons },
          attributes, purchaseIntent: { value: intent ? PURCHASE.has(intent) : null, evidenceType: intent ? "HYPOTHESIS" : "UNKNOWN", reason: "RULE_CLASSIFICATION_NOT_PURCHASE_PROOF" },
          demandEvidence: [], competition: { adsBiddingCompetition: [], organicSerpEvidence: unknown("NO_SERP_EVIDENCE") },
          seasonality: unknown("NO_SEASONAL_EVIDENCE"), availableLPs: [], existingOffers: [],
          observedRevenueEvidence: Object.fromEntries(["approvedRevenue", "revenue", "conversions", "epc"].map((k) => [k, unknown("NO_ATTRIBUTABLE_FUNNEL_EVIDENCE")])),
          evidenceFreshness: [], relatedExperiments: [], priorDecisions: [], measurementReadiness: [],
          signals: [], hypotheses: [], existingOpportunityRecords: [], counterEvidence: [], unknowns: [], reviewFlags: [], evidenceRefs: [], sourceIds: [], opportunityIds: [],
          lpReferences: [], linkReferences: links,
        };
        candidates.set(id, c);
      }
      for (const link of links) if (!c.linkReferences.some((l) => hash(l) === hash(link))) c.linkReferences.push(link);
      const add = (metric, value, options = {}) => {
        const e = evidence(s, metric, value, { ...options, scope: { sourceScope: s.scope, keyword: phrase(row.keyword), opportunityId: row.opportunityId ?? null, pageUrl: row.pageUrl ?? null }, recordReference: row.recordReference ?? row.opportunityId ?? null });
        const ref = register(e);
        if (!c.evidenceRefs.includes(ref)) c.evidenceRefs.push(ref);
        return ref;
      };
      if (!c.sourceIds.includes(s.sourceId)) c.sourceIds.push(s.sourceId);
      if (row.opportunityId && !c.opportunityIds.includes(row.opportunityId)) c.opportunityIds.push(row.opportunityId);
      if (!c.keywords.some((kw) => kw.original === row.keyword)) c.keywords.push({ original: row.keyword, normalized: phrase(original), canonicalForReferenceOnly: normalized.canonicalKeyword });
      if (row.pageUrl && !c.lpReferences.includes(row.pageUrl)) c.lpReferences.push(row.pageUrl);
      const labelRef = add("theme_seed", row.opportunityId ? row.name : row.keyword, { evidenceType: row.opportunityId ? "FACT" : "HYPOTHESIS" });
      if (!c.theme.evidenceRefs.includes(labelRef)) c.theme.evidenceRefs.push(labelRef);
      const demand = ["monthlySearches", "impressions", "clicks", "averagePosition", "ctr"];
      // A manual number is a supplied claim, not an automatically verified fact.
      // Declarations remain source assertions; they do not trigger verification.
      const metricType = (metric) => s.sourceType === "manual_csv"
        ? row[`${metric}EvidenceType`] || row.evidenceType || s.evidenceType || "UNKNOWN"
        : s.provider === "unknown" ? "UNKNOWN" : metric === "monthlySearches" || metric.startsWith("ads_") ? "ESTIMATE" : "FACT";
      for (const metric of demand) {
        const value = metric === "monthlySearches" && row.opportunityId ? numberOrNull(row.searchVolume) : row[metric] ?? null;
        if (value === null && !row.opportunityId && row[metric] === undefined) continue;
        const ref = add(metric, value, { evidenceType: metricType(metric), rawValue: row.rawValues?.[metric] ?? null,
          reason: metric === "monthlySearches" && value === null && row.rawValues?.[metric] ? "UNRESOLVED_OR_RANGE_VALUE" : null,
          unit: metric === "monthlySearches" ? "PROVIDER_ESTIMATED_MONTHLY_SEARCHES" : metric === "impressions" || metric === "clicks" ? "OWN_SITE_SEARCH_COUNT" : metric });
        if (!c.demandEvidence.includes(ref)) c.demandEvidence.push(ref);
      }
      for (const metric of ["competitionLevel", "competitionIndex", "lowTopOfPageBid", "highTopOfPageBid"]) if (row[metric] !== undefined && row[metric] !== "") {
        const ref = add(`ads_${metric}`, row[metric], { evidenceType: metricType(s.sourceType === "manual_csv" ? metric : `ads_${metric}`), rawValue: row.rawValues?.[metric] ?? null, reason: "ADS_BIDDING_PROXY_NOT_SEO_DIFFICULTY" });
        if (!c.competition.adsBiddingCompetition.includes(ref)) c.competition.adsBiddingCompetition.push(ref);
      }
      if (row.serpDifficulty) c.competition.organicSerpEvidence = { value: row.serpDifficulty, evidenceType: "ESTIMATE", reason: "EXISTING_OPPORTUNITY_NOTE_NOT_CURRENT_SERP", evidenceRefs: [add("organic_serp_note", row.serpDifficulty, { evidenceType: "ESTIMATE" })] };
      if (row.hypothesis && !c.hypotheses.some((h) => h.value === row.hypothesis)) c.hypotheses.push({ value: row.hypothesis, evidenceType: "HYPOTHESIS", evidenceRefs: [add("existing_hypothesis", row.hypothesis, { evidenceType: "HYPOTHESIS" })] });
      if (row.opportunityId && !c.existingOpportunityRecords.some((o) => o.id === row.opportunityId)) c.existingOpportunityRecords.push({ id: row.opportunityId, status: row.status ?? null, nextAction: row.nextAction ?? null, reviewDate: row.reviewDate ?? null });
      for (const note of row.counterEvidence ?? []) if (!c.counterEvidence.includes(note)) c.counterEvidence.push(note);
      for (const note of row.unknowns ?? []) if (!c.unknowns.includes(note)) c.unknowns.push(note);
      const safety = classifySafety(normalized.canonicalKeyword, RULES);
      const quality = classifyQueryQuality(normalized.canonicalKeyword, RULES);
      if (safety.safetyStatus !== "SAFE") c.reviewFlags.push(safety.safetyStatus);
      if (quality.queryQualityStatus !== "VALID") c.reviewFlags.push(quality.queryQualityStatus);
      if (!s.country || !s.language) c.reviewFlags.push("SOURCE_REGION_UNKNOWN");
      c.evidenceFreshness.push({ sourceId: s.sourceId, ...s.freshness });
    }
  }
  for (const c of candidates.values()) {
    if (!c.demandEvidence.length) c.unknowns.push("DEMAND_NOT_OBSERVED");
    else if (c.demandEvidence.some((id) => evidenceMap.get(id).value !== null)) c.signals.push("DEMAND_EVIDENCE_PRESENT_NOT_REVENUE_PROOF");
    if (c.isSynthetic) c.reviewFlags.push("SYNTHETIC_NOT_MARKET_VALIDATION");
  }
  return { candidates: [...candidates.values()].sort((a, b) => a.candidateId.localeCompare(b.candidateId)), evidence: evidenceMap };
}
