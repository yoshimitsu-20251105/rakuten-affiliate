import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { data as scorerData, run as score } from "./opportunity-scorer-helpers.js";
import { experiment, input as learningInput } from "./learning-engine-helpers.js";
import { emptyLedger, hash } from "../../learning-engine/model.js";
import { append } from "../../learning-engine/store.js";
import { buildReport as learningReport } from "../../learning-engine/report.js";
import { buildReport } from "../../experiment-selector/report.js";
import { validateInputsBundle } from "../../experiment-selector/sources.js";
import { POLICY_HASH, GROUP } from "../../experiment-selector/policy.js";

export const AS_OF = "2026-10-22T06:00:00Z";
export const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/experiment-selector-${name}.synthetic.json`, import.meta.url), "utf8"));
export const bytes = (v) => Buffer.from(JSON.stringify(v));
export function bindLedger(b, extra = []) {
  const source = { sourceId: "selector-registry", sourceType: "experiments", path: "registry.json", sourceReference: "SYNTHETIC contract only", isSynthetic: b.isSynthetic };
  const i = learningInput([[source, b.experimentsSnapshot], ...extra]);
  // Model factory hashes objects; file boundary must preserve the actual bytes.
  i.loaded[0].sourceFileHash = hash(bytes(b.experimentsSnapshot));
  // Rebuild with the byte hash rather than alter sealed provenance.
  return { manifest: i.manifest, loaded: i.loaded };
}
export async function setup({ realBranch = true, channel = "organic_search", registry = [], complete = true, mutate = null } = {}) {
  // realBranch is fabricated input to exercise production schema paths, NOT
  // real observations. Checked-in fixtures remain explicitly synthetic.
  const d = await scorerData({ nonSyntheticSchemaBranch: realBranch, complete });
  for (const c of d.scanner.candidates) c.relatedExperiments = [];
  for (const a of d.context.assessments) { a.channel = channel; if (channel === "note") a.purpose = "AFFILIATE_NOTE_ACQUISITION"; }
  if (mutate) mutate(d);
  const scannerHash = hash(bytes(d.scanner)), scorer = score(d, { scannerHash });
  const context = await fixture("context"); context.isSynthetic = !realBranch; context.policy.policyHash = POLICY_HASH;
  const b = { scannerReport: d.scanner, scorerReport: scorer, experimentsSnapshot: { items: registry }, selectionContext: context,
    isSynthetic: !realBranch, purpose: "AFFILIATE_MONETIZATION", asOf: AS_OF, measurementContexts: {} };
  context.proposals = scorer.assessments.map((a) => ({ proposalId: `proposal-${a.candidateId.slice(0, 8)}`, candidateId: a.candidateId,
    assessmentId: a.assessmentId, contextId: a.contextId, purpose: a.purpose, experimentClass: channel === "note" ? "AFFILIATE_NOTE_ACQUISITION" : "AFFILIATE_ACQUISITION",
    monetizationGroup: GROUP, channel, targetLP: a.targetLP, itemCodes: a.itemCodes,
    scope: { targetLP: a.targetLP, channel }, hypothesis: "SYNTHETIC purchase intent hypothesis", falsificationCondition: "Review recorded commission and missing data",
    primaryMetric: "approvedRevenue", successCondition: "SYNTHETIC explicit review threshold", reviewCondition: "Review after observation window",
    measurementPlan: "Saved funnel observations, never assumed zeros", variables: { contentPattern: "comparison" }, relatedExperimentIds: [] }));
  const { buildImport } = await import("../../learning-engine/sources.js");
  const { manifest, loaded } = bindLedger(b);
  b.learningLedger = append(emptyLedger(), buildImport(manifest, loaded, { recordedAt: "2026-10-22T00:00:00Z" })).ledger;
  return refresh(b);
}
export function refresh(b) {
  b.learningReport = learningReport(b.learningLedger, { asOf: AS_OF, generatedAt: AS_OF, runId: "synthetic-learning", isSynthetic: b.isSynthetic });
  b.selectionContext.registry.sourceFileHash = hash(bytes(b.experimentsSnapshot));
  b.hashes = Object.fromEntries(["scannerReport", "scorerReport", "learningReport", "learningLedger", "experimentsSnapshot", "selectionContext"].map((k) => [k, hash(bytes(b[k]))]));
  return Object.assign(b, validateInputsBundle(b, b.hashes, b));
}
export const run = (b) => buildReport(refresh(b), { runId: "synthetic-selector", generatedAt: AS_OF, codeCommit: "SYNTHETIC" });
export const active = (overrides = {}) => experiment({ experimentId: "synthetic-active", status: "RUNNING", result: null, decision: null,
  targetUrls: ["https://example.test/unrelated.html"], successThreshold: { conversions: 1 }, ...overrides });
export function classify(b, e, experimentClass, monetizationGroup = null) {
  const i = b.experimentsSnapshot.items.indexOf(e);
  b.selectionContext.experimentClassifications.push({ experimentId: e.experimentId, experimentClass, monetizationGroup, recordHash: hash(e),
    evidencePointers: [`/items/${i}/successThreshold`], reason: "SYNTHETIC reviewed objective", reviewedBy: "synthetic-reviewer", reviewedAt: AS_OF, confirmationReference: "SYNTHETIC test only" });
}
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "experiment-selector-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, write: async (name, value) => { const path = join(root, name); await writeFile(path, typeof value === "string" || Buffer.isBuffer(value) ? value : bytes(value)); return path; } };
}
export async function writeInputs(temp, b) {
  refresh(b); const inputs = {};
  for (const name of Object.keys(b.hashes)) { await temp.write(`${name}.json`, b[name]); inputs[name] = { path: `${name}.json`, sha256: b.hashes[name] }; }
  return temp.write("manifest.json", { schemaVersion: 1, purpose: b.purpose, isSynthetic: b.isSynthetic, inputs });
}
