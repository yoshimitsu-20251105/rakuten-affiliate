import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateMeasurementRecord } from "../funnel-measurement/measurement-status.js";
import { validateInputs as validateScanner } from "../opportunity-scorer/model.js";
import { assert, object, text, keys, strings, hash, scope, seal, emptyLedger, timestamp, date, period, validateMetric,
  PURPOSES, ACTIONS, METRICS, COLLECTIONS, EVIDENCE_TYPES } from "./model.js";

export const SOURCE_TYPES = ["experiments", "decisions", "funnel_report", "scanner_report", "scorer_report", "measurement_records"];
export const decodeJson = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
export function validateManifest(m) {
  keys(m, ["schemaVersion", "purpose", "sources", "links"]);
  assert(m.schemaVersion === 1 && PURPOSES.includes(m.purpose) && Array.isArray(m.sources), "Invalid manifest");
  assert(m.sources.filter((s) => s.sourceType === "experiments").length === 1, "Exactly one experiments source required");
  const ids = new Set();
  for (const s of m.sources) {
    keys(s, ["sourceId", "sourceType", "path", "sourceReference", "isSynthetic", "expectedSha256", "retrievedAt", "period", "timezone", "scope"]);
    assert(text(s.sourceId) && !ids.has(s.sourceId) && SOURCE_TYPES.includes(s.sourceType) && text(s.path) && text(s.sourceReference) && typeof s.isSynthetic === "boolean", "Invalid source");
    ids.add(s.sourceId);
    if (s.expectedSha256) assert(/^[a-f0-9]{64}$/.test(s.expectedSha256), "Invalid expected hash");
    if (s.retrievedAt) timestamp(s.retrievedAt); if (s.period) period(s.period); if (s.scope) scope(s.scope);
  }
  assert(Array.isArray(m.links ?? []), "Invalid links");
  for (const l of m.links ?? []) {
    keys(l, ["sourceId", "experimentId", "candidateId", "assessmentId", "contextId", "accountScopeId", "measurementId", "channel", "arm", "targetLP", "period", "evidenceRefs", "mappingEvidenceReference"]);
    assert(ids.has(l.sourceId) && text(l.experimentId), "Invalid source/experiment link"); strings(l.evidenceRefs ?? []);
    if (l.period) period(l.period); if (l.targetLP) scope({ targetLP: l.targetLP });
  }
}
export async function readManifestSources(manifest, baseDir) {
  validateManifest(manifest);
  const out = [];
  for (const spec of manifest.sources) {
    try {
      const bytes = await readFile(resolve(baseDir, spec.path));
      assert(!spec.expectedSha256 || hash(bytes) === spec.expectedSha256, "Source hash mismatch");
      out.push({ spec, sourceFileHash: hash(bytes), data: decodeJson(bytes) });
    } catch { throw new Error("Learning source read/hash/JSON validation failed; private input omitted"); }
  }
  return out;
}
function experimentScope(e) {
  return scope({ experimentIds: [e.experimentId], targetLP: e.targetUrls?.length === 1 ? e.targetUrls[0] : null,
    channel: e.trafficSource === "note_and_x_utm" ? null : e.trafficSource ?? null });
}
function validateExperiment(e) {
  assert(object(e) && text(e.experimentId) && text(e.title) && text(e.hypothesis) && text(e.falsificationCondition), "Invalid experiment");
  assert(["PLANNED", "RUNNING", "SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"].includes(e.status), "Invalid experiment status");
  assert(e.result == null || ["SUCCESS", "FAILED", "INCONCLUSIVE"].includes(e.result), "Invalid result");
  assert(e.decision == null || ACTIONS.includes(e.decision), "Invalid explicit decision");
  strings(e.targetUrls ?? []); strings(e.targetKeywords ?? []);
  for (const k of ["startDate", "reviewDate"]) if (e[k] != null) date(e[k]);
  assert(e.metrics == null || Array.isArray(e.metrics), "Invalid legacy metrics");
  for (const m of e.metrics ?? []) {
    assert(object(m) && text(m.metric) && Object.hasOwn(m, "value") && ["api", "url", "user_verified", "estimate", "hypothesis"].includes(m.sourceType), "Invalid legacy metric");
    if (m.observedAt != null) date(m.observedAt);
  }
  assert(e.learnings == null || Array.isArray(e.learnings) && e.learnings.every(text), "Invalid legacy learnings");
}
export function validateFunnel(r) {
  assert(r?.schemaVersion === 1 && r.purpose === "AFFILIATE_FUNNEL_MEASUREMENT" && Array.isArray(r.byMeasurementId) && object(r.attribution), "Invalid Funnel report");
  for (const k of METRICS) validateMetric(r.metrics?.[k]);
  if (r.generatedAt) timestamp(r.generatedAt);
  const b = r.sourceBatch;
  if (!b) { assert(!r.byMeasurementId.length, "Unimported Funnel cannot contain IDs"); return; }
  assert(text(b.importId) && text(b.accountScopeId) && typeof b.isSynthetic === "boolean" && Number.isInteger(b.recordCount) && b.recordCount >= 0, "Invalid Funnel batch");
  timestamp(b.snapshotAsOf); timestamp(b.retrievedAt); date(b.periodStart); date(b.periodEnd);
  assert(b.periodStart <= b.periodEnd && (b.recordCount > 0 || r.byMeasurementId.length === 0), "Invalid Funnel period/zero snapshot");
  const ids = new Set();
  for (const row of r.byMeasurementId) {
    assert(text(row.measurementId) && !ids.has(row.measurementId), "Invalid or duplicate measurement_id"); ids.add(row.measurementId);
    for (const k of ["approvedRevenue", "revenue", "conversions"]) {
      validateMetric(row.metrics?.[k]); const m = row.metrics[k];
      assert(m.scope?.accountScopeId === b.accountScopeId && m.scope?.measurementId === row.measurementId &&
        m.period?.start === b.periodStart && m.period?.end === b.periodEnd && m.snapshotAsOf === b.snapshotAsOf && m.importId === b.importId, "Funnel metric scope mismatch");
    }
  }
}
// SourceImports own raw-byte provenance. Semantically identical records retain one
// recordId even if the JSON was reformatted; each import still references that ID.
export function buildImport(manifest, loaded, { recordedAt = new Date().toISOString(), codeCommit = null } = {}) {
  validateManifest(manifest); recordedAt = timestamp(recordedAt);
  assert(loaded.length === manifest.sources.length, "Missing loaded source");
  const additions = emptyLedger(manifest.purpose);
  const experiments = loaded.find((s) => s.spec.sourceType === "experiments");
  assert(Array.isArray(experiments?.data?.items), "Invalid experiments collection");
  const experimentIds = new Set();
  for (const e of experiments.data.items) { validateExperiment(e); assert(!experimentIds.has(e.experimentId), "Duplicate experiment ID"); experimentIds.add(e.experimentId); }
  for (const l of manifest.links ?? []) assert(experimentIds.has(l.experimentId), "Linked experiment does not exist");
  for (const { spec, data, sourceFileHash } of loaded) {
    assert(manifest.sources.some((s) => hash(s) === hash(spec)) && /^[a-f0-9]{64}$/.test(sourceFileHash), "Loaded source mismatch");
    const refs = [], links = (manifest.links ?? []).filter((l) => l.sourceId === spec.sourceId);
    const add = (collection, payload) => {
      const record = seal(collection, { ...payload, purpose: manifest.purpose, sourceRefs: [{ sourceId: spec.sourceId, sourceType: spec.sourceType }], isSynthetic: spec.isSynthetic || payload.isSynthetic === true }, recordedAt);
      additions[collection].push(record); refs.push(record.recordId); return record;
    };
    const evidence = (metricOrClaim, value, s, extra = {}) => add("evidence", {
      metricOrClaim, value: structuredClone(value), rawValue: structuredClone(value), evidenceType: "UNKNOWN", availability: value === null ? "NOT_AVAILABLE" : "RECORDED",
      missingReason: value === null ? "NOT_OBSERVED" : null, scope: s, observedAt: null, period: spec.period ?? null,
      retrievedAt: spec.retrievedAt ?? null, timezone: spec.timezone ?? null, unit: null, freshness: "SOURCE_DATED_NOT_REFRESHED_ON_IMPORT", ...extra });
    if (spec.sourceType === "experiments") {
      for (const e of data.items) {
        const s = experimentScope(e);
        const metricRefs = (e.metrics ?? []).map((m) => {
          const type = { estimate: "ESTIMATE", hypothesis: "HYPOTHESIS" }[m.sourceType] ?? "FACT";
          return evidence(m.metric, m.value, s, { evidenceType: type, observedAt: m.observedAt ?? null,
            sourceObservation: m, availability: m.value === null ? "NOT_AVAILABLE" : "LEGACY_RECORDED_OBSERVATION",
            sourceDeclaredEvidenceType: type, validationStatus: "LEGACY_RECORDED_OBSERVATION_NOT_CURRENT_VERIFICATION" }).recordId;
        });
        const snapshot = add("experimentSnapshots", { experimentId: e.experimentId, scope: s, raw: e, evidenceRefs: metricRefs,
          effectiveDate: null, result: e.result ?? null, status: e.status, decision: e.decision ?? null,
          sourceDeclaredLearnings: (e.learnings ?? []).map((value) => ({ rawValue: value, sourceDeclaredEvidenceType: /^(FACT|ESTIMATE|HYPOTHESIS|UNKNOWN):/.exec(value)?.[1] ?? "UNKNOWN" })) });
        if (e.decision) add("decisions", { logicalId: `legacy-experiment:${e.experimentId}`, revisionId: hash(e), supersedesRevisionId: null, resolvesRevisionIds: [],
          type: "EXPERIMENT_REVIEW", experimentIds: [e.experimentId], decision: e.decision, rawDecision: e.decision, reason: "EXPLICIT_DECISION_IN_LEGACY_EXPERIMENT",
          scope: s, evidenceRefs: metricRefs, counterEvidenceRefs: [], snapshotRef: snapshot.recordId, reviewedBy: null, reviewedAt: null,
          effectiveDate: null, reviewDate: e.reviewDate ?? null, confirmationReference: null, retryPolicy: { mode: "UNKNOWN", reason: "NOT_STRUCTURED_IN_LEGACY_SOURCE" }, imported: true });
      }
    } else if (spec.sourceType === "decisions") {
      assert(Array.isArray(data?.items), "Invalid decisions collection"); const ids = new Set();
      for (const d of data.items) {
        assert(text(d.decisionId) && !ids.has(d.decisionId) && text(d.decision) && text(d.reasoningSummary), "Invalid legacy decision"); ids.add(d.decisionId); date(d.date);
        strings(d.relatedExperimentIds ?? []); assert((d.relatedExperimentIds ?? []).every((id) => experimentIds.has(id)), "Unknown decision experiment");
        add("decisions", { logicalId: d.decisionId, revisionId: hash(d), supersedesRevisionId: null, resolvesRevisionIds: [], type: "LEGACY_OTHER",
          experimentIds: d.relatedExperimentIds ?? [], decision: null, rawDecision: d.decision, raw: d, scope: scope({ experimentIds: d.relatedExperimentIds?.length ? d.relatedExperimentIds : null }),
          reason: d.reasoningSummary, evidenceRefs: [], counterEvidenceRefs: [], reviewedBy: null, reviewedAt: null, effectiveDate: d.date,
          reviewDate: d.reviewDate ?? null, confirmationReference: null, retryPolicy: { mode: "UNKNOWN", reason: "LEGACY_OTHER" }, imported: true });
      }
    } else if (spec.sourceType === "funnel_report") {
      validateFunnel(data);
      evidence("funnel_report", data, scope(), { availability: "SAVED_REPORT", generatedAt: data.generatedAt ?? null,
        snapshotAsOf: data.sourceBatch?.snapshotAsOf ?? null, retrievedAt: data.sourceBatch?.retrievedAt ?? spec.retrievedAt ?? null,
        isSynthetic: data.sourceBatch?.isSynthetic ?? false });
      const observations = [{ metrics: data.metrics }, ...data.byMeasurementId];
      for (const row of observations) for (const [metric, m] of Object.entries(row.metrics)) {
        if (![...METRICS, "cancelledRevenue", "merchandiseSales", "approvedEpc"].includes(metric)) continue;
        validateMetric(m);
        evidence(metric, m.value, scope(m.scope ?? {}), { evidenceType: m.evidenceType, availability: m.availability,
          missingReason: m.reason ?? null, period: m.period ?? null, retrievedAt: m.retrievedAt ?? null,
          snapshotAsOf: m.snapshotAsOf ?? null, observedThrough: m.observedThrough ?? null, observedAt: null,
          currency: m.currency ?? null, timezone: m.timezone ?? null, grain: m.grain ?? null,
          dateBasis: m.dateBasis ?? null, validationStatus: m.validationStatus ?? null, periodStatus: m.periodStatus ?? null,
          final: m.final ?? false, coverage: data.sourceBatch?.coverage ?? null, sourceObservation: m,
          isSynthetic: data.sourceBatch?.isSynthetic ?? false });
      }
    } else if (spec.sourceType === "scanner_report") {
      validateScanner(data);
      for (const l of links) if (l.candidateId) assert(data.candidates.some((c) => c.candidateId === l.candidateId), "Unknown linked candidate");
      evidence("scanner_report", data, scope(), { availability: "SAVED_REPORT", generatedAt: data.generatedAt ?? null,
        snapshotAsOf: data.asOf, isSynthetic: data.candidates.some((c) => c.isSynthetic) });
    } else if (spec.sourceType === "scorer_report") {
      assert(data?.schemaVersion === 1 && data.outputType === "OPPORTUNITY_ASSESSMENTS_ONLY" && Array.isArray(data.observedPerformance) && Array.isArray(data.assessments), "Invalid Scorer report");
      timestamp(data.asOf); assert(text(data.scannerRunId) && /^[a-f0-9]{64}$/.test(data.scannerFileHash), "Scorer provenance required");
      const scanner = loaded.find((s) => s.spec.sourceType === "scanner_report" && s.sourceFileHash === data.scannerFileHash && s.data.runId === data.scannerRunId);
      assert(scanner, "Scorer needs its exact saved Scanner source");
      for (const l of links) if (l.assessmentId || l.contextId || l.candidateId) assert(data.assessments.some((a) =>
        (!l.assessmentId || a.assessmentId === l.assessmentId) && (!l.contextId || a.contextId === l.contextId) && (!l.candidateId || a.candidateId === l.candidateId)), "Unknown linked assessment");
      for (const row of data.observedPerformance) for (const k of METRICS) validateMetric(row.metrics?.[k]);
      evidence("scorer_report", data, scope(), { evidenceType: "HYPOTHESIS", availability: "SAVED_REPORT", generatedAt: data.generatedAt ?? null,
        snapshotAsOf: data.asOf, isSynthetic: data.assessments.some((a) => a.isSynthetic) || scanner.spec.isSynthetic });
    } else if (spec.sourceType === "measurement_records") {
      const rows = Array.isArray(data) ? data : data?.targetLP ? [data] : data?.items;
      assert(Array.isArray(rows), "Invalid measurement collection");
      for (const m of rows) {
        validateMeasurementRecord(m);
        evidence("lp_measurement", m, scope({ targetLP: m.targetLP }), { evidenceType: "FACT", availability: "SAVED_MEASUREMENT_PROOF",
          verifiedAt: m.verifiedAt ?? null, isSynthetic: m.isSynthetic === true });
      }
    }
    const { path, expectedSha256, ...metadata } = spec;
    additions.sourceImports.push(seal("sourceImports", { ...metadata, purpose: manifest.purpose, sourceFileHash, adapterVersion: "learning-source-v1", codeCommit,
      recordRefs: [...new Set(refs)].sort(), links, sourceState: refs.length ? "LOADED" : "EMPTY" }, recordedAt));
  }
  // Never let an embedded synthetic source be relabelled as real by its wrapper.
  const all = new Map(COLLECTIONS.flatMap((k) => additions[k]).map((r) => [r.recordId, r]));
  for (const i of additions.sourceImports) assert(i.isSynthetic || i.recordRefs.every((id) => !all.get(id).isSynthetic), "Synthetic source must be declared synthetic");
  return additions;
}
