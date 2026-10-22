import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { validateInputs, inputPointer } from "../opportunity-scorer/model.js";
import { assessObservedPerformance } from "../opportunity-scorer/assessment.js";
import { compareObservedPerformance, compareExploration } from "../opportunity-scorer/comparison.js";
import { MAX_SCORES, PERFORMANCE_METRICS, POLICY_HASH as SCORER_POLICY_HASH, totalScore } from "../opportunity-scorer/policy.js";
import { validateLedger } from "../learning-engine/store.js";
import { visibleAt, purposeCompatible } from "../learning-engine/model.js";
import { assert, text, object, hash, canonical, timestamp, pointer, validateManifest, validateContext, INPUTS } from "./model.js";

export const parseJson = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
const comparisonFields = (rows, kind) => rows.map((r) => Object.fromEntries([kind === "observed" ? "candidateId" : "assessmentId", "comparisonGroup",
  kind === "observed" ? "performanceRank" : "explorationRank", "comparisonReasons", ...(kind === "observed" ? ["comparisonDepth"] : [])].map((k) => [k, r[k]])));
export function validateScorer(scanner, scorer, scannerHash) {
  const index = validateInputs(scanner);
  assert(scorer?.schemaVersion === 1 && scorer.outputType === "OPPORTUNITY_ASSESSMENTS_ONLY" && scorer.policyHash === SCORER_POLICY_HASH, "Unsupported Scorer snapshot");
  assert(scorer.scannerRunId === scanner.runId && scorer.scannerFileHash === scannerHash, "Scanner/Scorer source mismatch");
  timestamp(scorer.asOf); timestamp(scorer.generatedAt); assert(Date.parse(scanner.asOf) <= Date.parse(scorer.asOf), "Reversed Scanner/Scorer asOf");
  assert(Array.isArray(scorer.assessments) && Array.isArray(scorer.observedPerformance), "Invalid Scorer collections");
  // Revalidate saved financial FACT provenance at its original asOf. This is not
  // new attribution, data acquisition, or exploration rescoring.
  const observed = compareObservedPerformance(assessObservedPerformance(scanner, index, { asOf: scorer.asOf }));
  assert(canonical(observed) === canonical(scorer.observedPerformance), "Saved performance differs from Funnel provenance");
  const seen = new Set();
  for (const row of scorer.assessments) {
    const c = index.candidates.get(row.candidateId);
    assert(c && text(row.contextId) && row.assessmentId === hash([row.candidateId, row.contextId]) && !seen.has(row.assessmentId) && row.isSynthetic === c.isSynthetic, "Invalid assessment reference"); seen.add(row.assessmentId);
    assert(row.scannerFileHash === scannerHash && row.scannerRunId === scanner.runId && row.asOf === scorer.asOf, "Assessment snapshot mismatch");
    assert(row.exploration?.policyHash === SCORER_POLICY_HASH && row.exploration.evidenceType === "HYPOTHESIS", "Invalid exploration policy");
    for (const [key, max] of Object.entries(MAX_SCORES)) {
      const v = row.components?.[key];
      assert(object(v) && v.maxScore === max && ["HYPOTHESIS", "UNKNOWN"].includes(v.evidenceType), "Invalid fixed component");
      assert(v.value === null || typeof v.value === "number" && Number.isFinite(v.value) && v.value >= 0 && v.value <= max, "Invalid points");
      assert(v.evidenceType !== "UNKNOWN" || v.value === null, "UNKNOWN cannot have points");
      assert(Array.isArray(v.evidenceRefs) && v.evidenceRefs.every((id) => c.evidenceRefs.includes(id)), "Assessment evidence mismatch");
      for (const ref of v.inputRefs ?? []) inputPointer(scanner, c, ref);
      if (v.value !== null) assert(v.evidenceType === "HYPOTHESIS" && v.evidenceRefs.length + (v.inputRefs?.length ?? 0) > 0, "Points require source refs");
    }
    assert(totalScore(row.components) === row.exploration.totalScore, "Unknown/partial exploration total changed");
  }
  assert(scanner.candidates.every((c) => scorer.assessments.some((a) => a.candidateId === c.candidateId)), "Scorer omitted a candidate");
  const explored = compareExploration(structuredClone(scorer.assessments), index);
  assert(canonical(comparisonFields(explored, "exploration")) === canonical(comparisonFields(scorer.assessments, "exploration")), "Saved exploration comparison changed");
  return index;
}
export function validateInputsBundle(data, hashes, { asOf, isSynthetic = false, purpose = "AFFILIATE_MONETIZATION" } = {}) {
  timestamp(asOf); const { scannerReport: scanner, scorerReport: scorer, learningReport: learning, learningLedger: ledger,
    experimentsSnapshot: registry, selectionContext: context } = data;
  const index = validateScorer(scanner, scorer, hashes.scannerReport);
  validateLedger(ledger); validateContext(context, isSynthetic);
  assert(purposeCompatible(ledger.purpose, context.purpose) && context.purpose === purpose, "Purpose mismatch");
  assert(learning?.schemaVersion === 1 && learning.outputType === "EXPERIMENT_LEARNING_REVIEW_ONLY" && learning.ledgerHash === hash(ledger), "Learning ledger/report mismatch");
  assert(learning.isSynthetic === isSynthetic && Array.isArray(learning.experimentReviews) && Array.isArray(learning.learningIndex), "Invalid Learning view");
  for (const r of [scanner, scorer, learning]) {
    timestamp(r.asOf); timestamp(r.generatedAt);
    assert(Date.parse(r.asOf) <= Date.parse(asOf) && Date.parse(r.generatedAt) <= Date.parse(asOf), "Input is after Selector asOf");
  }
  assert(Array.isArray(registry?.items), "Registry items required"); const ids = new Set();
  for (const e of registry.items) {
    assert(text(e.experimentId) && !ids.has(e.experimentId), "Duplicate/invalid experiment ID"); ids.add(e.experimentId);
    assert(["PLANNED", "RUNNING", "SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"].includes(e.status) && Array.isArray(e.targetUrls), "Invalid registry status/LP");
    assert(!e.purpose || e.purpose !== "NOTE_NATIVE_MONETIZATION", "Native note is not an Affiliate registry input");
  }
  assert(context.registry.sourceFileHash === hashes.experimentsSnapshot, "Registry confirmation hash mismatch");
  const imported = ledger.sourceImports.find((s) => s.sourceType === "experiments" && s.sourceFileHash === hashes.experimentsSnapshot && s.isSynthetic === isSynthetic && visibleAt(ledger, s, asOf));
  assert(imported, "Current registry missing from Learning provenance; reimport outside Selector");
  for (const e of registry.items) {
    assert(imported.recordRefs.some((id) => ledger.experimentSnapshots.some((r) => r.recordId === id && r.experimentId === e.experimentId && canonical(r.raw) === canonical(e))), "Learning registry snapshot differs");
  }
  for (const c of context.experimentClassifications) {
    const idx = registry.items.findIndex((e) => e.experimentId === c.experimentId); assert(idx >= 0, "Classification has unknown experiment");
    for (const ref of c.evidencePointers) {
      assert(ref.startsWith(`/items/${idx}/`) && ["hypothesis", "falsificationCondition", "trafficSource", "successThreshold", "killThreshold", "experimentClass", "primaryMetric", "monetizationGroup"].includes(ref.split("/")[3]), "Classification must cite its own declared objective");
      pointer(registry, ref);
    }
  }
  for (const id of context.policy.selectionScope.candidateIds) assert(index.candidates.has(id), "Unknown declared candidate scope");
  for (const p of context.proposals) {
    const c = index.candidates.get(p.candidateId), a = scorer.assessments.find((r) => r.assessmentId === p.assessmentId);
    assert(c && c.isSynthetic === isSynthetic && a?.candidateId === p.candidateId && a.contextId === p.contextId, "Proposal assessment mismatch");
    assert(a.purpose === p.purpose && a.channel === p.channel && a.targetLP === p.targetLP, "Proposal must use its actual Scorer context");
    assert(c.availableLPs.some((l) => l.targetLP === p.targetLP) && p.itemCodes.length > 0 && p.itemCodes.every((id) => c.existingOffers.some((o) => o.itemCode === id)) &&
      canonical([...p.itemCodes].sort()) === canonical([...(a.itemCodes ?? [])].sort()), "Proposal LP/offer references mismatch");
    const required = c.relatedExperiments.map((e) => e.experimentId);
    assert(required.every((id) => p.relatedExperimentIds.includes(id)) && p.relatedExperimentIds.every((id) => ids.has(id)), "Proposal omitted or invented linked history");
  }
  return { ...data, hashes, index, asOf: timestamp(asOf), isSynthetic, purpose };
}
export async function readInputs(manifestPath, asOf) {
  try {
    const manifest = parseJson(await readFile(manifestPath)); validateManifest(manifest);
    const data = {}, hashes = {}, base = dirname(resolve(manifestPath));
    for (const name of INPUTS) {
      const bytes = await readFile(resolve(base, manifest.inputs[name].path)); hashes[name] = hash(bytes);
      assert(!manifest.inputs[name].sha256 || manifest.inputs[name].sha256 === hashes[name], "Input byte hash mismatch"); data[name] = parseJson(bytes);
    }
    const bundle = validateInputsBundle(data, hashes, { asOf, isSynthetic: manifest.isSynthetic, purpose: manifest.purpose });
    const contexts = {};
    for (const p of data.selectionContext.proposals) if (p.measurement) {
      const file = resolve(dirname(resolve(base, manifest.inputs.selectionContext.path)), p.measurement.htmlPath);
      contexts[p.proposalId] = { currentPageHash: hash(await readFile(file)) };
    }
    return { ...bundle, measurementContexts: contexts };
  } catch { throw new Error("Selector input/hash/reference validation failed; private input omitted"); }
}
