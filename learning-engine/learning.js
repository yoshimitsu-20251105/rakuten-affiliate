import { assert, object, text, keys, strings, scope, scopeCovers, seal, hash, canonical, timestamp, date, knownAt,
  emptyLedger, PURPOSES, ACTIONS, EVIDENCE_TYPES, METRICS, validateCondition, visibleAt, purposeCompatible } from "./model.js";

export function activeRevisions(records, asOf) {
  const rows = records.filter((r) => knownAt(r, asOf)), groups = new Map();
  for (const r of rows) { const key = r.logicalId; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([logicalId, versions]) => {
    const replaced = new Set(versions.flatMap((r) => [r.supersedesRevisionId, ...(r.resolvesRevisionIds ?? [])]).filter(Boolean));
    const leaves = versions.filter((r) => !replaced.has(r.revisionId));
    return { logicalId, state: leaves.length === 1 ? leaves[0].reviewStatus === "RETRACTED" ? "RETRACTED" : "ACTIVE" : "CONFLICT",
      active: leaves.length === 1 ? leaves[0] : null, leaves, history: versions.map((r) => r.recordId).sort() };
  });
}
export const missingMetric = (reason = "NOT_ATTRIBUTABLE") => ({ value: null, evidenceType: "UNKNOWN", availability: "NOT_AVAILABLE", missingReason: reason, sourceObservation: null, evidenceRefs: [] });

// Explicit, scoped binding evidence is required in addition to an ID appearing in
// a real report. Neither shared LPs nor UTM names allocate account earnings.
export function performanceForExperiment(ledger, experimentId, asOf) {
  const available = new Map(ledger.evidence.filter((r) => visibleAt(ledger, r, asOf)).map((r) => [r.recordId, r]));
  const imports = ledger.sourceImports.filter((r) => !r.isSynthetic && knownAt(r, asOf));
  const allLinks = imports.flatMap((s) => (s.links ?? []).map((l) => ({ ...l, importRecord: s })));
  const matches = [], reasons = [];
  for (const l of allLinks.filter((l) => l.experimentId === experimentId && l.measurementId)) {
    const source = l.importRecord;
    if (source.isSynthetic || !text(l.mappingEvidenceReference) || !l.period || !text(l.accountScopeId) || !text(l.targetLP)) { reasons.push("MAPPING_EVIDENCE_INCOMPLETE"); continue; }
    const shared = allLinks.some((x) => x.accountScopeId === l.accountScopeId && x.measurementId === l.measurementId && x.period &&
      x.period.start <= l.period.end && x.period.end >= l.period.start && (x.experimentId !== experimentId || (x.channel ?? null) !== (l.channel ?? null)));
    if (shared) { reasons.push("SHARED_MEASUREMENT_ID"); continue; }
    const binding = (l.evidenceRefs ?? []).map((id) => available.get(id)).filter(Boolean).some((e) => !e.isSynthetic && e.evidenceType === "FACT" &&
      e.metricOrClaim === "measurement_id" && e.value === l.measurementId && e.observedAt && e.observedAt <= l.period.start &&
      scopeCovers(e.scope, scope({ experimentIds: [experimentId], targetLP: l.targetLP, channel: l.channel ?? null })));
    if (!binding) { reasons.push("MAPPING_EVIDENCE_NOT_ESTABLISHED"); continue; }
    for (const ref of source.recordRefs) {
      const e = available.get(ref), r = e?.value, b = r?.sourceBatch;
      if (e?.metricOrClaim !== "funnel_report" || e.isSynthetic || !b || b.isSynthetic || !knownAt(b, asOf)) continue;
      const entry = r.byMeasurementId.find((row) => row.measurementId === l.measurementId);
      if (!entry || b.recordCount === 0) { reasons.push("MEASUREMENT_ID_NOT_IN_RECORDS"); continue; }
      if (b.accountScopeId !== l.accountScopeId || l.period.start > b.periodStart || l.period.end < b.periodEnd || b.coverage !== "COMPLETE") { reasons.push("SCOPE_OR_COVERAGE_MISMATCH"); continue; }
      const cohort = hash([b.accountScopeId, l.measurementId, b.periodStart, b.periodEnd, b.currency, b.timezone, b.dateBasis]);
      matches.push({ e, r, b, l, entry, cohort });
    }
  }
  let selected = null, reason = reasons[0] ?? "NOT_ATTRIBUTABLE";
  if (matches.length) {
    if (new Set(matches.map((m) => m.cohort)).size !== 1) reason = "INCOMPATIBLE_SCOPES";
    else {
      const last = Math.max(...matches.map((m) => Date.parse(m.b.snapshotAsOf)));
      const latest = matches.filter((m) => Date.parse(m.b.snapshotAsOf) === last);
      if (new Set(latest.map((m) => hash(m.entry))).size > 1) reason = "CONFLICT";
      else selected = latest[0];
    }
  }
  return { metrics: Object.fromEntries(METRICS.map((key) => {
    if (!selected) return [key, missingMetric(reason)];
    const { entry, r, b, l, e } = selected;
    const raw = key === "epc" ? r.metrics.epc : entry.metrics[key];
    let gap = null;
    if (!raw || raw.value === null) gap = raw?.reason ?? raw?.availability ?? "NOT_AVAILABLE";
    else if (raw.evidenceType !== "FACT" || raw.availability !== "OBSERVED") gap = "NOT_OBSERVED_FACT";
    else if (key === "conversions" && raw.validationStatus !== "VERIFIED") gap = "PARTIALLY_VERIFIED";
    else if (raw.scope?.measurementId !== l.measurementId || raw.scope?.accountScopeId !== b.accountScopeId ||
      raw.period?.start !== b.periodStart || raw.period?.end !== b.periodEnd || raw.snapshotAsOf !== b.snapshotAsOf ||
      raw.grain !== "MEASUREMENT_ID" || raw.timezone !== b.timezone || raw.dateBasis !== b.dateBasis ||
      !raw.observedThrough || raw.observedThrough < b.periodStart || raw.observedThrough > b.periodEnd || !knownAt(raw, asOf)) gap = "METRIC_SCOPE_NOT_ESTABLISHED";
    else if (!/^[A-Z]{3}$/.test(b.currency ?? "") || key !== "conversions" && raw.currency !== b.currency) gap = "CURRENCY_NOT_ESTABLISHED";
    else if (key === "epc" && r.attribution?.epcCompatibility?.compatible !== true) gap = "CLICK_COHORT_NOT_VERIFIED";
    return [key, { ...(gap ? missingMetric(gap) : structuredClone(raw)), value: gap ? null : raw.value,
      missingReason: gap, sourceObservation: structuredClone(raw ?? null), evidenceRefs: [e.recordId], mappingEvidenceRefs: l.evidenceRefs,
      attributedScope: scope({ experimentIds: [experimentId], targetLP: l.targetLP, channel: l.channel ?? null, accountScopeId: b.accountScopeId, measurementId: l.measurementId }) }];
  })) };
}

function revisionFields(r) {
  assert(text(r.logicalId) && text(r.revisionId) && r.revisionId !== r.supersedesRevisionId, "Invalid revision identity");
  assert(r.supersedesRevisionId == null || text(r.supersedesRevisionId), "Invalid parent revision"); strings(r.resolvesRevisionIds ?? []);
  assert(!(r.resolvesRevisionIds ?? []).includes(r.revisionId), "Self revision reference");
}
export function validateRevisionGraph(rows) {
  const all = new Map();
  for (const r of rows) {
    revisionFields(r); const id = canonical([r.logicalId, r.revisionId]);
    assert(!all.has(id) || all.get(id).recordId === r.recordId, "Same logicalId/revision has different content"); all.set(id, r);
  }
  for (const r of rows) {
    for (const id of [r.supersedesRevisionId, ...(r.resolvesRevisionIds ?? [])].filter(Boolean)) {
      const parent = all.get(canonical([r.logicalId, id]));
      assert(parent && parent.isSynthetic === r.isSynthetic && Date.parse(parent.recordedAt) <= Date.parse(r.recordedAt), "Revision parent missing or incompatible");
    }
    const visit = (node, seen) => {
      assert(!seen.has(node.revisionId), "Revision cycle"); const next = new Set([...seen, node.revisionId]);
      for (const id of [node.supersedesRevisionId, ...(node.resolvesRevisionIds ?? [])].filter(Boolean)) visit(all.get(canonical([node.logicalId, id])), next);
    };
    visit(r, new Set());
  }
}
function policy(p) {
  keys(p, ["mode", "reason"]); assert(["CONDITIONAL", "NO_RETRY_PROPOSED", "UNKNOWN"].includes(p.mode) && text(p.reason), "Invalid retry policy");
}
function requireEvidence(ledger, refs, review, requestedScope, recordedAt, requireFact = false) {
  strings(refs); const index = new Map(ledger.evidence.map((e) => [e.recordId, e]));
  return refs.map((id) => {
    const e = index.get(id);
    assert(e && visibleAt(ledger, e, recordedAt) && e.isSynthetic === review.isSynthetic, "Missing/future/synthetic evidence reference");
    assert(knownAt({ ...e, recordedAt: review.reviewedAt }, review.reviewedAt), "Evidence was observed/retrieved after the stated review");
    if (requireFact) assert(e.evidenceType === "FACT" && e.value !== null && scopeCovers(e.scope, requestedScope), "FACT scope/provenance not established");
    return e;
  });
}
export function buildReview(ledger, review, { recordedAt = new Date().toISOString(), sourceFileHash = hash(review) } = {}) {
  keys(review, ["schemaVersion", "purpose", "reviewId", "isSynthetic", "reviewedAt", "reviewedBy", "confirmationReference", "decisions", "learnings"]);
  assert(review.schemaVersion === 1 && purposeCompatible(ledger.purpose, review.purpose) && text(review.reviewId) && typeof review.isSynthetic === "boolean", "Invalid review");
  recordedAt = timestamp(recordedAt); timestamp(review.reviewedAt);
  assert(Date.parse(review.reviewedAt) <= Date.parse(recordedAt) && text(review.reviewedBy) && text(review.confirmationReference), "Explicit review confirmation required");
  assert(Array.isArray(review.decisions) && Array.isArray(review.learnings) && review.decisions.length + review.learnings.length > 0, "Empty review");
  const additions = emptyLedger(ledger.purpose), sourceId = `review:${review.reviewId}`;
  const experimentIds = new Set(ledger.experimentSnapshots.filter((e) => visibleAt(ledger, e, recordedAt) && e.isSynthetic === review.isSynthetic).map((e) => e.experimentId));
  for (const [collection, rows] of [["decisions", review.decisions], ["learnings", review.learnings]]) for (const row of rows) {
    keys(row, ["logicalId", "revisionId", "supersedesRevisionId", "resolvesRevisionIds", "experimentIds", "scope", "evidenceRefs", "counterEvidenceRefs", "reason",
      ...(collection === "decisions" ? ["decision", "retryPolicy", "reviewDate"] : ["decisionRefs", "claim", "reviewStatus", "falsification", "retryConditions", "unknowns", "limitations", "scopeEvidenceRefs"])]);
    revisionFields(row); strings(row.experimentIds);
    assert(row.experimentIds.length > 0 && row.experimentIds.every((id) => experimentIds.has(id)) && text(row.reason), "Review needs existing experiment and reason");
    const s = scope(row.scope); assert(s.experimentIds && row.experimentIds.every((id) => s.experimentIds.includes(id)), "Review experiment scope mismatch");
    requireEvidence(ledger, row.evidenceRefs, review, s, recordedAt); requireEvidence(ledger, row.counterEvidenceRefs, review, s, recordedAt);
    if (row.resolvesRevisionIds?.length) {
      const group = activeRevisions(ledger[collection], recordedAt).find((g) => g.logicalId === row.logicalId);
      assert(group?.state === "CONFLICT" && group.leaves.every((r) => row.resolvesRevisionIds.includes(r.revisionId)), "Conflict resolution must name every active leaf");
    }
    if (collection === "decisions") {
      assert(ACTIONS.includes(row.decision), "Invalid decision"); policy(row.retryPolicy); if (row.reviewDate) date(row.reviewDate);
    } else {
      keys(row.claim, ["text", "metricOrClaim", "value", "unit", "evidenceType", "missingReason"]);
      assert(text(row.claim.text) && text(row.claim.metricOrClaim) && Object.hasOwn(row.claim, "value") && EVIDENCE_TYPES.includes(row.claim.evidenceType), "Invalid learning claim");
      assert(["PROPOSED", "ACCEPTED", "RETRACTED"].includes(row.reviewStatus), "Invalid learning review state");
      assert(row.claim.evidenceType !== "UNKNOWN" || row.claim.value === null && text(row.claim.missingReason), "UNKNOWN must remain null with reason");
      if (row.claim.evidenceType === "FACT") {
        assert(row.evidenceRefs.length > 0 && row.claim.value !== null, "FACT observation required");
        if (METRICS.includes(row.claim.metricOrClaim)) {
          assert(!review.isSynthetic && row.experimentIds.length === 1, "FACT financial learning needs real scoped observation");
          const m = performanceForExperiment(ledger, row.experimentIds[0], recordedAt).metrics[row.claim.metricOrClaim];
          assert(m.value !== null && m.value === row.claim.value && m.evidenceRefs.some((id) => row.evidenceRefs.includes(id)) && scopeCovers(m.attributedScope, s), "Financial FACT not observed/attributable");
        } else {
          const records = requireEvidence(ledger, row.evidenceRefs, review, s, recordedAt, true);
          assert(records.some((e) => e.metricOrClaim === row.claim.metricOrClaim && canonical(e.value) === canonical(row.claim.value) && !["lp_measurement", "funnel_report"].includes(e.metricOrClaim)), "FACT must match a literal source observation");
        }
      }
      strings(row.decisionRefs ?? []); strings(row.unknowns ?? []); strings(row.limitations ?? []);
      const decisions = [...ledger.decisions, ...additions.decisions];
      assert((row.decisionRefs ?? []).every((id) => decisions.some((d) => d.recordId === id && d.isSynthetic === review.isSynthetic && d.experimentIds.some((x) => row.experimentIds.includes(x)))), "Unknown decision reference");
      requireEvidence(ledger, row.scopeEvidenceRefs ?? [], review, s, recordedAt);
      const f = row.falsification;
      keys(f, ["hypothesisRef", "conditionText", "status", "evidenceRefs", "counterEvidenceRefs", "reason"]);
      assert(row.experimentIds.includes(f.hypothesisRef) && text(f.conditionText) && text(f.reason) && ["SUPPORTED", "FALSIFIED", "INCONCLUSIVE", "UNKNOWN"].includes(f.status), "Invalid falsification assessment");
      requireEvidence(ledger, f.evidenceRefs, review, s, recordedAt); requireEvidence(ledger, f.counterEvidenceRefs, review, s, recordedAt);
      assert(Array.isArray(row.retryConditions), "Retry conditions required"); const ids = new Set();
      for (const c of row.retryConditions) {
        validateCondition(c); assert(!ids.has(c.conditionId), "Duplicate conditionId"); ids.add(c.conditionId);
        requireEvidence(ledger, c.evidenceRefs, review, scope(c.scope), recordedAt);
      }
    }
    additions[collection].push(seal(collection, { ...row, scope: s, supersedesRevisionId: row.supersedesRevisionId ?? null,
      resolvesRevisionIds: row.resolvesRevisionIds ?? [], reviewedAt: review.reviewedAt, reviewedBy: review.reviewedBy,
      confirmationReference: review.confirmationReference, purpose: review.purpose, sourceRefs: [{ sourceId, sourceType: "review" }],
      ...(collection === "decisions" ? { type: "EXPERIMENT_REVIEW", imported: false } : {}), isSynthetic: review.isSynthetic }, recordedAt));
  }
  for (const collection of ["decisions", "learnings"]) validateRevisionGraph([...ledger[collection], ...additions[collection]]);
  for (const d of additions.decisions.filter((d) => d.retryPolicy.mode === "CONDITIONAL")) {
    assert([...additions.learnings, ...ledger.learnings].some((l) => l.experimentIds.some((id) => d.experimentIds.includes(id)) && l.retryConditions?.length), "Conditional decision needs explicit retry conditions");
  }
  additions.sourceImports.push(seal("sourceImports", { sourceId, sourceType: "review", sourceReference: review.confirmationReference, sourceFileHash,
    adapterVersion: "learning-review-v1", purpose: review.purpose, isSynthetic: review.isSynthetic, recordRefs: [...additions.decisions, ...additions.learnings].map((r) => r.recordId).sort(), links: [], sourceState: "LOADED" }, recordedAt));
  return additions;
}
