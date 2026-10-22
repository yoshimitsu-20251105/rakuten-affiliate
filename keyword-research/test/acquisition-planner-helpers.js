import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setup as selectorSetup, run as selectorRun, bytes, active, classify } from "./experiment-selector-helpers.js";
import { input as learningInput, spec, verified } from "./learning-engine-helpers.js";
import { recordsBytes as csvBytes, meta as csvMeta } from "./funnel-helpers.js";
import { append } from "../../learning-engine/store.js";
import { buildReport } from "../../acquisition-planner/report.js";
import { hash, POLICY_HASH, CURRENT_INPUTS, PROTOCOL_FIELDS } from "../../acquisition-planner/model.js";
import { INPUTS as ORIGINAL_INPUTS } from "../../experiment-selector/model.js";

export { bytes, active, classify };
export const AS_OF = "2026-10-22T06:30:00Z";
export const MID = "synthetic-id-dog";
export const affiliateLink = `https://hb.afl.rakuten.co.jp/synthetic-link?synthetic_mid=${MID}`;
export const HTML = `<!doctype html><title>SYNTHETIC ONLY</title><a href="${affiliateLink}">Synthetic offer</a>`;
export const PAGE_HASH = hash(HTML);
export const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/acquisition-planner-${name}.synthetic.json`, import.meta.url), "utf8"));
export const protocol = (channel) => ({ contentUnit: "unit-01", variant: "v1", contentPurpose: channel === "organic_search" ? "EXISTING_LP_ORGANIC_OBSERVATION" : "AFFILIATE_LP_ACQUISITION",
  contentPattern: "comparison", titlePattern: "synthetic-title-pattern", ctaPattern: "synthetic-existing-pattern", fixedVariables: { existingAssets: "unchanged" },
  changedVariable: { name: channel === "organic_search" ? null : "contentPattern", from: null, to: channel === "organic_search" ? null : "comparison", reason: "Synthetic planned test; not an executed change" },
  requiredMetrics: ["approvedRevenue"], requiredTrafficGrain: channel === "organic_search" ? "ORGANIC_PAGE_PERIOD" : "CAMPAIGN_CONTENT", attributionScope: "MEASUREMENT_ID_ONLY" });
export async function setup({ channel = "x", realBranch = true, noRecommendation = false, counterEvidence = false } = {}) {
  // All data is fabricated, including realBranch exercising the non-synthetic
  // schema. Neither branch establishes real market or nonzero CSV validation.
  const original = await selectorSetup({ channel, realBranch, mutate: (d) => { for (const c of d.scanner.candidates) for (const l of c.availableLPs) l.repositoryPageHash = PAGE_HASH;
    if (counterEvidence) d.scanner.candidates[0].counterEvidence.push("SYNTHETIC counter evidence to review"); } });
  const p = original.selectionContext.proposals.find((p) => p.candidateId === original.scannerReport.candidates[0].candidateId);
  p.variables.acquisition = protocol(channel); original.selectionContext.proposals = noRecommendation ? [] : [p];
  if (counterEvidence) p.historyReview = { counterEvidenceHashes: [hash("SYNTHETIC counter evidence to review")], reviewedBy: "SYNTHETIC reviewer", reviewedAt: "2026-10-22T06:00:00Z", reason: "Explicitly reviewed, not disproven" };
  if (channel === "note" && !noRecommendation) {
    const record = verified({ targetLP: p.targetLP, verifiedPageHash: PAGE_HASH, evidence: { ...verified().evidence, targetLP: p.targetLP } });
    const i = learningInput([[spec("experiments", { isSynthetic: !realBranch }), original.experimentsSnapshot], [spec("measurement_records", { isSynthetic: !realBranch }), [record]]]);
    original.learningLedger = append(original.learningLedger, i.additions).ledger;
    p.measurement = { evidenceRef: original.learningLedger.evidence.find((e) => e.metricOrClaim === "lp_measurement").recordId, htmlPath: "historical.html", ga4PropertyReference: record.ga4PropertyReference };
    original.measurementContexts[p.proposalId] = { currentPageHash: PAGE_HASH };
  }
  const selectorReport = selectorRun(original), context = await fixture("context"); context.isSynthetic = !realBranch; context.policy.policyHash = POLICY_HASH;
  context.selectedProposalId = noRecommendation ? null : p.proposalId;
  if (!noRecommendation) context.plan = { experimentId: "synthetic-new-experiment", candidateId: p.candidateId, channel, targetLP: p.targetLP, ...structuredClone(p.variables.acquisition) };
  context.policy.providerPolicy = { accountScopeId: "synthetic-account", measurementParameter: "synthetic_mid", allowedHostnames: ["hb.afl.rakuten.co.jp"],
    confirmedBy: "SYNTHETIC reviewer", confirmedAt: "2026-10-22T06:00:00Z", evidenceReference: "SYNTHETIC parameter policy, not live Rakuten validation", validPeriod: { start: "2026-10-01", end: "2026-10-31" } };
  if (!noRecommendation) {
    context.measurementId.binding = { measurementId: MID, accountScopeId: "synthetic-account", experimentId: context.plan.experimentId, candidateId: p.candidateId, channel,
      targetLP: p.targetLP, pageHash: PAGE_HASH, affiliateLink, confirmedBy: "SYNTHETIC reviewer", confirmedAt: "2026-10-22T06:00:00Z",
      validPeriod: { start: "2026-10-01", end: "2026-10-31" }, exclusivity: "EXPERIMENT_CHANNEL", evidenceReference: "SYNTHETIC literal anchor QA", isSynthetic: !realBranch };
    context.checklistConfirmations = ["TRAFFIC_GRAIN", "CHANNEL_HANDOFF"].map((checkId) => ({ checkId, status: "PASS", targetLP: p.targetLP, channel, pageHash: PAGE_HASH,
      proposalId: p.proposalId, policyHash: POLICY_HASH, reviewedBy: "SYNTHETIC reviewer", reviewedAt: AS_OF, sourceReference: "SYNTHETIC offline capability proof" }));
  }
  const current = { experimentsSnapshot: structuredClone(original.experimentsSnapshot), learningLedger: structuredClone(original.learningLedger),
    selectionContext: structuredClone(original.selectionContext), html: {}, measurementContexts: {}, hashes: {} };
  if (!noRecommendation) { current.html[p.proposalId] = HTML; current.measurementContexts[p.proposalId] = { currentPageHash: PAGE_HASH }; }
  const currentStateManifest = { schemaVersion: 1, purpose: "AFFILIATE_MONETIZATION", isSynthetic: !realBranch,
    inputs: Object.fromEntries(CURRENT_INPUTS.map((k) => [k, { path: `current-${k}.json` }])), htmlSnapshots: !noRecommendation ? [{ proposalId: p.proposalId, targetLP: p.targetLP, path: "current.html" }] : [],
    identityIndex: { coverage: "COMPLETE", scope: "KNOWN_AFFILIATE_IDENTIFIERS", observedAt: AS_OF, maxAgeDays: 1, sourceReference: "SYNTHETIC known registry only", entries: [] } };
  return refresh({ original, selectorReport, current, currentStateManifest, planningContext: context, hashes: {}, asOf: AS_OF, isSynthetic: !realBranch, purpose: "AFFILIATE_MONETIZATION", historicalHTML: HTML, orderEvidence: null });
}
export function refresh(b) {
  for (const k of CURRENT_INPUTS) b.current.hashes[k] = hash(bytes(b.current[k]));
  b.current.selectionContext.registry.sourceFileHash = b.current.hashes.experimentsSnapshot;
  b.current.hashes.selectionContext = hash(bytes(b.current.selectionContext));
  b.hashes = { selectorReport: hash(bytes(b.selectorReport)), selectorInputManifest: hash(b.original.hashes), currentStateManifest: hash(bytes(b.currentStateManifest)), planningContext: hash(bytes(b.planningContext)),
    ...Object.fromEntries(ORIGINAL_INPUTS.map((k) => [`original.${k}`, b.original.hashes[k]])), ...Object.fromEntries(CURRENT_INPUTS.map((k) => [`current.${k}`, b.current.hashes[k]])) };
  for (const [id, html] of Object.entries(b.current.html)) { b.current.measurementContexts[id] = { currentPageHash: hash(html) }; b.hashes[`current.html.${id}`] = hash(html); }
  if (b.orderEvidence) { b.hashes["current.orderCSV"] = hash(b.orderEvidence.csv); b.hashes["current.orderMetadata"] = hash(bytes(b.orderEvidence.metadata)); }
  return b;
}
export const run = (b, options = {}) => buildReport(refresh(b), { generatedAt: AS_OF, codeCommit: "SYNTHETIC", ...options });
export function addOrder(b, rows = [{ status: "1", id: MID, rewards: "123", amount: "12300" }]) {
  b.orderEvidence = { csv: csvBytes(rows), metadata: csvMeta({ isSynthetic: b.isSynthetic }) };
  b.currentStateManifest.orderEvidence = { csv: { path: "order.csv", sha256: hash(b.orderEvidence.csv) }, metadata: { path: "order-metadata.json" } };
  b.hashes["current.orderCSV"] = hash(b.orderEvidence.csv); b.hashes["current.orderMetadata"] = hash(bytes(b.orderEvidence.metadata)); return b;
}
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "acquisition-planner-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, write: async (name, value) => { const path = join(root, name); await writeFile(path, typeof value === "string" || Buffer.isBuffer(value) ? value : bytes(value)); return path; } };
}
export async function writeInputs(temp, b) {
  refresh(b); const originalInputs = {};
  for (const k of ORIGINAL_INPUTS) { await temp.write(`original-${k}.json`, b.original[k]); originalInputs[k] = { path: `original-${k}.json`, sha256: b.original.hashes[k] }; }
  const om = { schemaVersion: 1, purpose: b.original.purpose, isSynthetic: b.isSynthetic, inputs: originalInputs, htmlSnapshots: [] };
  for (const p of b.original.selectionContext.proposals.filter((p) => p.measurement)) { await temp.write("historical.html", b.historicalHTML); om.htmlSnapshots.push({ proposalId: p.proposalId, targetLP: p.targetLP, path: "historical.html", sha256: hash(b.historicalHTML) }); }
  for (const k of CURRENT_INPUTS) await temp.write(`current-${k}.json`, b.current[k]);
  for (const p of b.original.selectionContext.proposals) if (b.current.html[p.proposalId] != null) await temp.write("current.html", b.current.html[p.proposalId]);
  if (b.orderEvidence) { await temp.write("order.csv", b.orderEvidence.csv); await temp.write("order-metadata.json", b.orderEvidence.metadata); }
  const values = { selectorReport: b.selectorReport, selectorInputManifest: om, currentStateManifest: b.currentStateManifest, planningContext: b.planningContext }, inputs = {};
  for (const[k,v]of Object.entries(values)) { await temp.write(`${k}.json`, v); inputs[k] = { path: `${k}.json`, sha256: hash(bytes(v)) }; }
  return temp.write("manifest.json", { schemaVersion: 1, purpose: b.purpose, isSynthetic: b.isSynthetic, inputs });
}
export async function currentRegistry(b, items) {
  const { buildImport } = await import("../../learning-engine/sources.js");
  const s = { sourceId: "planner-current-registry", sourceType: "experiments", path: "current-registry.json", sourceReference: "SYNTHETIC current state", isSynthetic: b.isSynthetic };
  const data = { items }, m = { schemaVersion: 1, purpose: b.purpose, sources: [s], links: [] };
  b.current.learningLedger = append(b.current.learningLedger, buildImport(m, [{ spec: s, data, sourceFileHash: hash(bytes(data)) }], { recordedAt: AS_OF })).ledger;
  b.current.experimentsSnapshot = data; refresh(b); return b;
}
export function currentProof(b, record) {
  const p = b.current.selectionContext.proposals[0];
  const i = learningInput([[spec("experiments", { isSynthetic: b.isSynthetic }), b.current.experimentsSnapshot], [spec("measurement_records", { isSynthetic: b.isSynthetic }), [record]]], { recordedAt: AS_OF });
  b.current.learningLedger = append(b.current.learningLedger, i.additions).ledger;
  p.measurement = { evidenceRef: i.additions.evidence.find((e) => e.metricOrClaim === "lp_measurement").recordId, htmlPath: "current.html", ga4PropertyReference: record.ga4PropertyReference ?? "synthetic-property" }; return b;
}
