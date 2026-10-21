import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { SITE_URL } from "../lib/site-config.js";
import { validateMeasurementRecord, measurementAvailability } from "../funnel-measurement/measurement-status.js";
import { assert, hash, phrase, evidence, unknown, EVIDENCE_TYPES, date, freshness } from "./model.js";

const byType = (sources, type) => sources.filter((s) => s.sourceType === type).flatMap((source) => source.rows.map((row) => ({ source, row })));
const containsKeyword = (c, keyword) => c.keywords.some((k) => k.normalized === phrase(keyword) || phrase(k.original) === phrase(keyword));

function canonicalLP(value) {
  const url = new URL(value);
  assert(url.protocol === "https:" && !url.search && !url.hash && !url.username && !url.password, "LPはクエリなしの正規HTTPS URLが必要です");
  return url.href;
}
function inventoryURL(row) {
  return row.targetLP ? canonicalLP(row.targetLP) : canonicalLP(`${SITE_URL}/${row.path}`);
}
async function localLP(repoRoot, path) {
  if (!path) return { presence: unknown("NO_LOCAL_PATH"), pageHash: null };
  const docs = resolve(repoRoot, "docs"), full = resolve(docs, path);
  const rel = relative(docs, full);
  assert(rel && !rel.startsWith("..") && !isAbsolute(rel), "LP pathがdocs外です");
  try {
    const actual = await realpath(full), actualRel = relative(await realpath(docs), actual);
    assert(actualRel && !actualRel.startsWith("..") && !isAbsolute(actualRel), "LP symlinkがdocs外です");
    return { presence: { value: true, evidenceType: "FACT", reason: "LOCAL_REPOSITORY_FILE_ONLY" }, pageHash: hash(await readFile(full)) };
  } catch (e) {
    if (e.code === "ENOENT") return { presence: { value: false, evidenceType: "FACT", reason: "LOCAL_FILE_NOT_FOUND" }, pageHash: null };
    throw e;
  }
}

/** Related evidence only: no API lookup, experiment selection, or state updates. */
export async function attachLinkage(assembly, sources, { repoRoot, asOf }) {
  const { candidates, evidence: evidenceMap } = assembly;
  const inventory = byType(sources, "lp_inventory"), offers = byType(sources, "offers"), seasons = byType(sources, "seasonality"),
    experiments = byType(sources, "experiments"), decisions = byType(sources, "decisions"), competitors = byType(sources, "competitors"),
    measurements = byType(sources, "measurement_records"), funnels = byType(sources, "funnel_report");
  for (const { row } of measurements) validateMeasurementRecord(row);
  const claims = new Map();
  for (const c of candidates) for (const link of c.linkReferences) for (const m of link.measurementIdMappings ?? []) {
    const key = hash([m.accountScopeId, m.measurementId]);
    if (!claims.has(key)) claims.set(key, new Set()); claims.get(key).add(c.candidateId);
  }
  for (const c of candidates) {
    const add = (s, name, value, options = {}) => {
      const e = evidence(s, name, value, { ...options, scope: { sourceScope: s.scope, candidateId: c.candidateId, observedScope: options.scope ?? null } });
      if (!evidenceMap.has(e.evidenceId)) evidenceMap.set(e.evidenceId, e);
      if (!c.evidenceRefs.includes(e.evidenceId)) c.evidenceRefs.push(e.evidenceId);
      c.evidenceFreshness.push({ sourceId: s.sourceId, ...s.freshness });
      return e.evidenceId;
    };
    const lpLinks = [...c.linkReferences.filter((l) => l.targetLP || l.lpSlug).map((l) => {
      const inv = inventory.find(({ row }) => l.lpSlug ? row.slug === l.lpSlug : inventoryURL(row) === canonicalLP(l.targetLP));
      assert(!l.lpSlug || inv, "mappingのlpSlugがinventoryに存在しません");
      return { url: l.targetLP ? canonicalLP(l.targetLP) : inventoryURL(inv.row), path: inv?.row.path ?? l.lpPath ?? null, reference: l.evidenceReference ?? null, inv };
    }), ...c.lpReferences.map((url) => ({ url: canonicalLP(url), path: inventory.find(({ row }) => inventoryURL(row) === url)?.row.path ?? null, reference: "GSC_QUERY_PAGE_OBSERVATION" }))];
    const seenLP = new Set();
    for (const link of lpLinks) {
      if (seenLP.has(link.url)) continue;
      seenLP.add(link.url);
      if (!link.path && link.url.startsWith(`${SITE_URL}/`)) link.path = link.url.slice(SITE_URL.length + 1);
      const local = await localLP(repoRoot, link.path);
      c.availableLPs.push({ targetLP: link.url, repositoryPresence: local.presence, repositoryPageHash: local.pageHash,
        relevance: { value: true, evidenceType: "HYPOTHESIS", reason: link.reference ?? "DECLARED_MAPPING_NOT_INTENT_PROOF" },
        liveAvailability: unknown("OFFLINE_NO_LIVE_REQUEST"), sourceReference: link.inv?.source.sourceReference ?? link.reference });
      const found = measurements.filter(({ row }) => row.targetLP === link.url);
      let state = { status: "NOT_VERIFIED", reason: found.length > 1 ? "AMBIGUOUS_MEASUREMENT_RECORDS" : "NO_MEASUREMENT_RECORD" };
      if (found.length === 1 && found[0].source.isSynthetic === c.isSynthetic) {
        const record = found[0].row;
        state = measurementAvailability(record, { targetLP: link.url, currentPageHash: local.pageHash, ga4PropertyReference: record.ga4PropertyReference, at: asOf });
      }
      c.measurementReadiness.push({ targetLP: link.url, affiliateClickMeasurementStatus: state.status, evidenceId: state.evidenceId ?? null,
        reason: state.reason, verificationScope: "OFFLINE_CURRENT_REPOSITORY_HASH_NOT_LIVE_CHECK", canStartExperiment: false,
        evidenceRefs: found.map(({ source, row }) => add(source, "lp_measurement_record", row, { recordReference: row.evidenceId ?? row.targetLP })) });
      if (state.status !== "VERIFIED") c.reviewFlags.push("LP_MEASUREMENT_NOT_VERIFIED");
    }
    if (c.availableLPs.length) c.signals.push("EXISTING_LP_REFERENCE"); else c.unknowns.push("NO_CONFIRMED_LP_MAPPING");
    const itemCodes = new Set(c.linkReferences.flatMap((l) => l.itemCodes ?? []));
    for (const { source, row } of offers.filter(({ row }) => itemCodes.has(row.itemCode))) {
      if (row.snapshotDate) date(row.snapshotDate, "offer snapshotDate");
      c.existingOffers.push({ itemCode: row.itemCode, recordedPrice: row.itemPrice ?? null, snapshotDate: row.snapshotDate ?? null,
        isSynthetic: source.isSynthetic,
        productLinkRecorded: Boolean(row.itemUrl), affiliateLinkRecorded: Boolean(row.affiliateUrl), currentAvailability: unknown("NO_CURRENT_AVAILABILITY_CHECK"),
        currentPrice: unknown("NO_CURRENT_PRICE_CHECK"), evidenceRefs: [add(source, "recorded_offer", { itemCode: row.itemCode, itemPrice: row.itemPrice ?? null, snapshotDate: row.snapshotDate ?? null }, { recordReference: row.itemCode })] });
    }
    if (!c.existingOffers.length) c.unknowns.push("NO_CONFIRMED_OFFER_MAPPING");
    const seasonIds = new Set(c.linkReferences.flatMap((l) => l.seasonalityIds ?? []));
    const relatedSeasons = seasons.filter(({ row }) => seasonIds.has(row.id) || phrase(row.theme) === phrase(c.theme.value));
    if (relatedSeasons.length) c.seasonality = {
      value: relatedSeasons.map(({ source, row }) => {
        assert(EVIDENCE_TYPES.includes(row.confidence), "seasonality confidenceが不正です");
        assert(Array.isArray(row.peakMonths) && row.peakMonths.every((m) => Number.isInteger(m) && m >= 1 && m <= 12), "seasonality peakMonthsが不正です");
        return { id: row.id, peakMonths: row.peakMonths, leadTimeDays: row.leadTimeDays ?? null, notes: row.notes ?? null, evidenceType: row.confidence,
          evidenceRefs: [add(source, "seasonality", { peakMonths: row.peakMonths, notes: row.notes ?? null }, { evidenceType: row.confidence, recordReference: row.id })] };
      }), evidenceType: "HYPOTHESIS", reason: "READ_COMPONENT_EVIDENCE_TYPES_NO_BLANKET_PROMOTION",
    };
    const expIds = new Set(c.linkReferences.flatMap((l) => l.experimentIds ?? []));
    const urls = new Set(c.availableLPs.map((l) => l.targetLP));
    for (const { source, row } of experiments.filter(({ row }) => expIds.has(row.experimentId) || (row.targetUrls ?? []).some((url) => urls.has(url)))) {
      c.relatedExperiments.push({ experimentId: row.experimentId, status: row.status ?? null, decision: row.decision ?? null, result: row.result ?? null,
        startDate: row.startDate ?? null, reviewDate: row.reviewDate ?? null, learnings: row.learnings ?? [],
        evidenceRefs: [add(source, "experiment_record", row, { recordReference: row.experimentId })] });
      if (row.status === "RUNNING") c.reviewFlags.push("RUNNING_EXPERIMENT");
      if (row.decision === "KILL") { c.reviewFlags.push("PREVIOUSLY_KILLED_REVIEW_REQUIRED"); c.unknowns.push("WHY_REVISIT_REQUIRES_NEW_EVIDENCE"); }
    }
    const relevantExperiments = new Set(c.relatedExperiments.map((e) => e.experimentId));
    const decisionIds = new Set(c.linkReferences.flatMap((l) => l.decisionIds ?? []));
    for (const { source, row } of decisions.filter(({ row }) => decisionIds.has(row.decisionId) || (row.relatedExperimentIds ?? []).some((id) => relevantExperiments.has(id)))) c.priorDecisions.push({ ...row, evidenceRefs: [add(source, "decision_record", row, { recordReference: row.decisionId })] });
    const organic = competitors.filter(({ row, source }) => containsKeyword(c, row.keyword) && (!source.country || source.country === c.country) && (!source.language || source.language === c.language));
    if (organic.length) c.competition.organicSerpEvidence = {
      value: organic.map(({ source, row }) => ({ ...row, evidenceType: ({ api: "FACT", url: "FACT", user_verified: "FACT", estimate: "ESTIMATE", hypothesis: "HYPOTHESIS" })[row.sourceType] ?? "UNKNOWN",
        evidenceRefs: [add(source, "organic_serp_observation", row, { evidenceType: ({ api: "FACT", url: "FACT", user_verified: "FACT", estimate: "ESTIMATE", hypothesis: "HYPOTHESIS" })[row.sourceType] ?? "UNKNOWN", recordReference: row.id })] })),
      reason: "OBSERVED_AT_NOT_CURRENT_DIFFICULTY", evidenceType: "UNKNOWN",
    };
    const matches = [];
    for (const link of c.linkReferences) for (const mapping of link.measurementIdMappings ?? []) {
      assert(typeof mapping.measurementId === "string" && mapping.measurementId && typeof mapping.accountScopeId === "string", "measurementId mapping識別子が不正です");
      date(mapping.validFrom, "mapping.validFrom"); date(mapping.validThrough, "mapping.validThrough");
      assert(mapping.validFrom <= mapping.validThrough, "mapping期間が逆です");
      for (const { source, row: report } of funnels) {
        const batch = report.sourceBatch;
        if (!batch || batch.accountScopeId !== mapping.accountScopeId) continue;
        const entry = report.byMeasurementId.find((v) => v.measurementId === mapping.measurementId);
        if (!entry) continue; // zero-record account snapshots cannot create an ID-level zero
        const shared = (claims.get(hash([mapping.accountScopeId, mapping.measurementId]))?.size ?? 0) > 1;
        const valid = Date.parse(batch.snapshotAsOf) <= Date.parse(asOf) && !shared && mapping.exclusiveToCandidate === true && typeof mapping.evidenceReference === "string" && mapping.evidenceReference &&
          source.isSynthetic === c.isSynthetic && batch.isSynthetic === c.isSynthetic && mapping.validFrom <= batch.periodStart && mapping.validThrough >= batch.periodEnd &&
          urls.has(mapping.targetLP);
        if (valid && (!source.retrievedAt || Date.parse(source.retrievedAt) <= Date.parse(asOf))) matches.push({ source, report, entry, mapping });
        else c.reviewFlags.push(shared ? "SHARED_MEASUREMENT_ID" : "UNPROVEN_REVENUE_MAPPING");
      }
    }
    const uniqueMap = new Map();
    for (const m of matches) {
      const key = hash([m.report.sourceBatch.importId, m.mapping.measurementId]);
      const prior = uniqueMap.get(key);
      assert(!prior || hash(prior.entry) === hash(m.entry), "同一Funnel importIdの成果内容が競合しています");
      if (!prior) uniqueMap.set(key, m);
    }
    const unique = [...uniqueMap.values()];
    if (unique.length === 1) {
      const { source, report, entry, mapping } = unique[0];
      for (const key of ["approvedRevenue", "revenue", "conversions"]) {
        const metric = entry.metrics[key];
        if (!metric) continue;
        assert(metric.scope?.measurementId === mapping.measurementId && metric.scope?.accountScopeId === mapping.accountScopeId, "Funnel metric scopeがmappingと一致しません");
        const economicSource = { ...source, periodStart: metric.period?.start ?? report.sourceBatch.periodStart, periodEnd: metric.period?.end ?? report.sourceBatch.periodEnd,
          timezone: metric.timezone ?? report.sourceBatch.timezone ?? null, retrievedAt: metric.retrievedAt ?? source.retrievedAt, grain: metric.grain ?? "MEASUREMENT_ID" };
        economicSource.freshness = freshness(economicSource, asOf, source.freshness.policy);
        c.observedRevenueEvidence[key] = { ...metric, mappingEvidenceReference: mapping.evidenceReference,
          evidenceRefs: [add(economicSource, `attributed_${key}`, metric.value, { evidenceType: metric.evidenceType ?? "UNKNOWN", availability: metric.availability, reason: metric.reason,
            unit: metric.currency ?? metric.unit ?? null, scope: metric.scope, recordReference: report.sourceBatch.importId })] };
      }
      c.observedRevenueEvidence.epc = { ...unknown("SCANNER_DOES_NOT_RECONSTRUCT_CLICK_COHORTS"), sourceEpc: report.metrics.epc ?? null };
    } else if (unique.length > 1) {
      c.reviewFlags.push("MULTIPLE_FUNNEL_SNAPSHOTS_NOT_SUMMED");
      for (const key of Object.keys(c.observedRevenueEvidence)) c.observedRevenueEvidence[key] = unknown("MULTIPLE_FUNNEL_SNAPSHOTS");
    }
    if (c.observedRevenueEvidence.revenue.value === null) c.unknowns.push("REVENUE_NOT_ATTRIBUTABLE_TO_CANDIDATE");
    if (!c.isSynthetic && c.evidenceRefs.some((id) => evidenceMap.get(id).isSynthetic)) c.reviewFlags.push("SYNTHETIC_AUXILIARY_EVIDENCE_NOT_VALIDATED");
    for (const field of ["signals", "reviewFlags", "unknowns", "evidenceRefs", "sourceIds", "opportunityIds"]) c[field] = [...new Set(c[field])].sort();
    c.keywords.sort((a, b) => a.original.localeCompare(b.original));
    c.evidenceFreshness = [...new Map(c.evidenceFreshness.map((f) => [hash(f), f])).values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
    delete c.linkReferences; delete c.lpReferences;
  }
  return assembly;
}
