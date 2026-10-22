import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateInputsBundle as validateSelectorInputs } from "../experiment-selector/sources.js";
import { validateManifest as validateSelectorManifest, validateContext as validateSelectorContext, pointer, INPUTS as SELECTOR_INPUTS } from "../experiment-selector/model.js";
import { buildReport as replaySelector } from "../experiment-selector/report.js";
import { validateLedger } from "../learning-engine/store.js";
import { visibleAt, purposeCompatible } from "../learning-engine/model.js";
import { parseRakutenOrder } from "../funnel-measurement/rakuten-order.js";
import { assert, keys, text, hash, canonical, timestamp, validateManifest, validateCurrentManifest, validateContext, validateHTMLRows, ROOT_INPUTS, CURRENT_INPUTS, reason } from "./model.js";

export const decode = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
export const without = (value, excluded) => Object.fromEntries(Object.entries(value).filter(([k]) => !excluded.includes(k)));
export function validateBundle(b) {
  const r = b.selectorReport, current = b.current, c = b.planningContext;
  timestamp(b.asOf); validateContext(c, b.isSynthetic); validateCurrentManifest(b.currentStateManifest, b.isSynthetic);
  assert(b.purpose === c.purpose && purposeCompatible(current.learningLedger.purpose, c.purpose), "Planner purpose mismatch");
  assert(r?.schemaVersion === 1 && r.outputType === "EXPERIMENT_SELECTION_RECOMMENDATION_ONLY" && r.isSynthetic === b.isSynthetic, "Unsupported Selector report");
  timestamp(r.asOf); timestamp(r.generatedAt);
  assert(Date.parse(r.asOf) <= Date.parse(b.asOf) && Date.parse(r.generatedAt) <= Date.parse(b.asOf), "Selector knowledge is after Planner asOf");
  assert(r.recommendationCount === r.recommendations?.length && r.recommendations.length <= 1 && Array.isArray(r.proposals), "Invalid recommendation cardinality");
  assert(canonical(r.selectedProposal) === canonical(r.recommendations[0] ?? null), "Selector selected pointer mismatch");
  assert(r.canStartExperiment === false && r.requiresStartTimeRevalidation === true, "Selector action contract mismatch");
  for (const k of SELECTOR_INPUTS) assert(r.inputHashes[k] === b.original.hashes[k], "Original source hash mismatch");
  const original = validateSelectorInputs(b.original, b.original.hashes, { asOf: r.asOf, isSynthetic: b.isSynthetic, purpose: b.original.purpose });
  for (const k of ["sourceImports", "experimentSnapshots", "evidence", "decisions", "learnings"]) assert(!original.learningLedger[k].some((r) => r.purpose === "NOTE_NATIVE_MONETIZATION"), "Native note history is excluded");
  original.measurementContexts = b.original.measurementContexts ?? {};
  assert(r.learningLedgerHash === hash(original.learningLedger), "Original Learning canonical hash mismatch");
  const missingHistoryHTML = original.selectionContext.proposals.some((p) => p.measurement && !original.measurementContexts[p.proposalId]);
  if (!missingHistoryHTML) {
    const replay = replaySelector(original, { runId: r.runId, generatedAt: r.generatedAt, codeCommit: r.codeCommit });
    assert(canonical(replay) === canonical(r), "Original Selector result does not reproduce");
  }
  const selected = r.recommendations[0] ?? null;
  const p = selected ? original.selectionContext.proposals.find((p) => p.proposalId === selected.proposalId && p.candidateId === selected.candidateId) : null;
  assert(!selected || p && r.proposals.some((x) => x.selected && x.proposalId === p.proposalId && x.candidateId === p.candidateId), "Selected proposal/candidate mismatch");
  assert(!r.proposals.some((x) => x.selected && x.proposalId !== selected?.proposalId), "Multiple selected rows");
  validateLedger(current.learningLedger); validateSelectorContext(current.selectionContext, b.isSynthetic);
  for (const k of ["sourceImports", "experimentSnapshots", "evidence", "decisions", "learnings"]) assert(!current.learningLedger[k].some((r) => r.purpose === "NOTE_NATIVE_MONETIZATION"), "Native note record is excluded");
  assert(purposeCompatible(current.learningLedger.purpose, original.purpose) && b.currentStateManifest.purpose === b.purpose, "Current state purpose mismatch");
  const registry = current.experimentsSnapshot, ids = new Set(); assert(Array.isArray(registry?.items), "Current registry required");
  for (const e of registry.items) {
    assert(text(e.experimentId) && !ids.has(e.experimentId) && ["PLANNED", "RUNNING", "SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"].includes(e.status) && Array.isArray(e.targetUrls), "Current registry invalid/duplicate"); ids.add(e.experimentId);
    assert(e.purpose !== "NOTE_NATIVE_MONETIZATION", "Native note is excluded");
  }
  assert(current.selectionContext.registry.sourceFileHash === current.hashes.experimentsSnapshot, "Current registry confirmation hash mismatch");
  const issues = missingHistoryHTML ? [reason("ORIGINAL_VERIFICATION_SNAPSHOT_MISSING", "MANUAL_REVIEW_REQUIRED", "selectorInputManifest", "/htmlSnapshots")] : [];
  const imported = current.learningLedger.sourceImports.find((s) => s.sourceType === "experiments" && s.sourceFileHash === current.hashes.experimentsSnapshot && s.isSynthetic === b.isSynthetic && visibleAt(current.learningLedger, s, b.asOf));
  if (!imported || !registry.items.every((e) => imported.recordRefs.some((id) => current.learningLedger.experimentSnapshots.some((s) => s.recordId === id && canonical(s.raw) === canonical(e)))))
    issues.push(reason("CURRENT_REGISTRY_LEARNING_IMPORT_MISSING", "MANUAL_REVIEW_REQUIRED", "current.learningLedger", "/sourceImports"));
  if (["experimentSnapshots", "evidence", "decisions", "learnings"].some((k) => original.learningLedger[k].some((o) => !current.learningLedger[k].some((n) => canonical(n) === canonical(o)))))
    issues.push(reason("LEARNING_HISTORY_NOT_APPEND_ONLY", "MANUAL_REVIEW_REQUIRED", "current.learningLedger", "/"));
  for (const cl of current.selectionContext.experimentClassifications) {
    const i = registry.items.findIndex((e) => e.experimentId === cl.experimentId); assert(i >= 0, "Classification of unknown current experiment");
    for (const r of cl.evidencePointers) {
      assert(r.startsWith(`/items/${i}/`) && ["hypothesis", "falsificationCondition", "trafficSource", "successThreshold", "killThreshold", "experimentClass", "primaryMetric", "monetizationGroup"].includes(r.split("/")[3]), "Classification must cite its own objective"); pointer(registry, r);
    }
  }
  const cp = p && current.selectionContext.proposals.find((x) => x.proposalId === p.proposalId);
  if (p && (!cp || canonical(without(cp, ["measurement", "historyReview"])) !== canonical(without(p, ["measurement", "historyReview"]))))
    issues.push(reason("SELECTED_SCOPE_MISMATCH", "BLOCKED", "current.selectionContext", "/proposals"));
  if (p?.measurement && cp?.measurement && p.measurement.ga4PropertyReference !== cp.measurement.ga4PropertyReference)
    issues.push(reason("MEASUREMENT_PROPERTY_CHANGED", "BLOCKED", "current.selectionContext", "/proposals"));
  for (const [id, html] of Object.entries(current.html)) assert(hash(html) === current.measurementContexts[id]?.currentPageHash, "Current HTML/hash mismatch");
  if (canonical(current.selectionContext.policy) !== canonical(original.selectionContext.policy))
    issues.push(reason("CURRENT_SELECTION_POLICY_CHANGED_REVIEW_REQUIRED", "MANUAL_REVIEW_REQUIRED", "current.selectionContext", "/policy"));
  let orderSnapshot = null;
  if (b.orderEvidence) {
    const { csv, metadata } = b.orderEvidence;
    assert(hash(csv) === b.currentStateManifest.orderEvidence?.csv.sha256, "Original CSV byte hash mismatch");
    assert(metadata.isSynthetic === b.isSynthetic, "Order evidence synthetic mismatch");
    orderSnapshot = parseRakutenOrder(csv, metadata, { importedAt: metadata.retrievedAt });
    assert(Date.parse(orderSnapshot.batch.retrievedAt) <= Date.parse(b.asOf), "Future order evidence");
  }
  return { ...b, original, selectedProposal: p, currentProposal: cp ?? p, sourceIssues: issues, orderSnapshot };
}

export async function readInputs(path, asOf) {
  try {
    const root = dirname(resolve(path)), manifest = decode(await readFile(path)); validateManifest(manifest); timestamp(asOf);
    const hashes = {}, locations = {}, data = {};
    const read = async (spec, base, sourceId, binary = false) => {
      const full = resolve(base, spec.path), bytes = await readFile(full), digest = hash(bytes);
      assert(!spec.sha256 || spec.sha256 === digest, "Expected raw hash mismatch"); hashes[sourceId] = digest; locations[sourceId] = full;
      return binary ? bytes : decode(bytes);
    };
    for (const k of ROOT_INPUTS) data[k] = await read(manifest.inputs[k], root, k);
    const om = data.selectorInputManifest; keys(om, ["schemaVersion", "purpose", "isSynthetic", "inputs", "htmlSnapshots"]);
    validateSelectorManifest(without(om, ["htmlSnapshots"])); validateHTMLRows(om.htmlSnapshots ?? []);
    assert(om.isSynthetic === manifest.isSynthetic, "Original manifest synthetic mismatch");
    const original = { purpose: om.purpose, hashes: {}, measurementContexts: {} }, obase = dirname(locations.selectorInputManifest);
    for (const k of SELECTOR_INPUTS) { original[k] = await read(om.inputs[k], obase, `original.${k}`); original.hashes[k] = hashes[`original.${k}`]; }
    for (const h of om.htmlSnapshots ?? []) {
      const p = original.selectionContext.proposals.find((p) => p.proposalId === h.proposalId && p.targetLP === h.targetLP); assert(p, "Unknown original HTML scope");
      const bytes = await read(h, obase, `original.html.${h.proposalId}`, true); original.measurementContexts[h.proposalId] = { currentPageHash: hash(bytes) };
    }
    const cm = data.currentStateManifest; validateCurrentManifest(cm, manifest.isSynthetic);
    const current = { hashes: {}, measurementContexts: {}, html: {} }, cbase = dirname(locations.currentStateManifest);
    for (const k of CURRENT_INPUTS) { current[k] = await read(cm.inputs[k], cbase, `current.${k}`); current.hashes[k] = hashes[`current.${k}`]; }
    for (const h of cm.htmlSnapshots) {
      const p = original.selectionContext.proposals.find((p) => p.proposalId === h.proposalId && p.targetLP === h.targetLP); assert(p, "Unknown current HTML scope");
      const bytes = await read(h, cbase, `current.html.${h.proposalId}`, true); current.html[h.proposalId] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      current.measurementContexts[h.proposalId] = { currentPageHash: hash(bytes) };
    }
    let orderEvidence = null;
    if (cm.orderEvidence) orderEvidence = { csv: await read(cm.orderEvidence.csv, cbase, "current.orderCSV", true), metadata: await read(cm.orderEvidence.metadata, cbase, "current.orderMetadata") };
    return validateBundle({ ...data, original, current, hashes, orderEvidence, asOf: timestamp(asOf), isSynthetic: manifest.isSynthetic, purpose: manifest.purpose });
  } catch { throw new Error("Planner input/hash/provenance validation failed; private details omitted"); }
}
