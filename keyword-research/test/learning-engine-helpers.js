import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hash, emptyLedger, scope, seal } from "../../learning-engine/model.js";
import { buildImport } from "../../learning-engine/sources.js";
import { append } from "../../learning-engine/store.js";
import { buildReview } from "../../learning-engine/learning.js";
import { targetLP, html, pageHash, verified, zeroBytes, recordsBytes, meta } from "./funnel-helpers.js";
import { parseRakutenOrder } from "../../funnel-measurement/rakuten-order.js";
import { buildFunnelReport } from "../../funnel-measurement/report.js";

export { targetLP, html, pageHash, verified };
export const AS_OF = "2026-10-22T06:00:00Z", IMPORTED_AT = "2026-10-22T00:00:00Z";
export const readFixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/learning-engine-${name}.synthetic.json`, import.meta.url), "utf8"));
export const experiment = (overrides = {}) => ({ experimentId: "synthetic-exp", title: "Synthetic exposure test", hypothesis: "Exposure hypothesis, not revenue proof",
  falsificationCondition: "Zero impressions at review", targetUrls: [targetLP], targetKeywords: ["synthetic keyword"], trafficSource: "organic_search", monetizationSource: "rakuten",
  startDate: "2026-09-10", reviewDate: "2026-10-10", status: "FAILED", result: "FAILED", decision: "IMPROVE", baseline: null,
  successThreshold: { impressions: 10 }, killThreshold: { impressions: 0 },
  metrics: [{ metric: "search_console_impressions", value: 0, sourceType: "api", source: "synthetic saved GSC", observedAt: "2026-10-10" },
    { metric: "search_console_impressions", value: 2, sourceType: "api", source: "synthetic new GSC", observedAt: "2026-10-21" }],
  learnings: ["FACT: old observed exposure 0", "HYPOTHESIS: intent mismatch", "UNKNOWN: Revenue"], ...overrides });
export const spec = (sourceType, overrides = {}) => ({ sourceId: sourceType, sourceType, path: `${sourceType}.json`, sourceReference: "synthetic-source", isSynthetic: true, ...overrides });
export function input(entries, { links = [], purpose = "AFFILIATE_MONETIZATION", recordedAt = IMPORTED_AT } = {}) {
  const loaded = entries.map(([s, data]) => ({ spec: s, data, sourceFileHash: hash(data) }));
  const manifest = { schemaVersion: 1, purpose, sources: loaded.map((x) => x.spec), links };
  return { manifest, loaded, additions: buildImport(manifest, loaded, { recordedAt, codeCommit: "synthetic-commit" }) };
}
export function base(options = {}) {
  const { nonSyntheticSchemaBranch = false, extra = [], experimentOverrides = {}, links = [] } = options;
  // Fabricated data can exercise the non-synthetic schema path; it is never a
  // real report or evidence of nonzero Rakuten data validation.
  const entries = [[spec("experiments", { isSynthetic: !nonSyntheticSchemaBranch }), { items: [experiment(experimentOverrides)] }], ...extra];
  const i = input(entries, { links }); return { ...i, ledger: append(emptyLedger(), i.additions).ledger };
}
export async function reviewed(options = {}) {
  const b = base(options), review = await readFixture("review"), proposal = await readFixture("proposal");
  if (options.nonSyntheticSchemaBranch) { review.isSynthetic = false; proposal.isSynthetic = false; }
  const added = buildReview(b.ledger, review, { recordedAt: IMPORTED_AT });
  const ledger = append(b.ledger, added).ledger;
  const fresh = ledger.evidence.find((e) => e.observedAt === "2026-10-21"); proposal.newEvidenceRefs = [fresh.recordId];
  return { ...b, ledger, review, proposal, fresh };
}
export function addEvidence(ledger, payload, { recordedAt = IMPORTED_AT, isSynthetic = true } = {}) {
  const e = seal("evidence", { metricOrClaim: "test_metric", value: 1, rawValue: 1, evidenceType: "FACT", availability: "OBSERVED",
    scope: scope({ experimentIds: ["synthetic-exp"], targetLP, channel: "organic_search" }), observedAt: "2026-10-21",
    sourceRefs: [{ sourceId: "test-extra", sourceType: "experiments" }], isSynthetic, ...payload }, recordedAt);
  const source = seal("sourceImports", { sourceId: "test-extra", sourceType: "experiments", sourceReference: "synthetic-test", sourceFileHash: hash(payload),
    isSynthetic, recordRefs: [e.recordId], links: [], sourceState: "LOADED" }, recordedAt);
  const a = emptyLedger(); a.evidence.push(e); a.sourceImports.push(source);
  return { evidence: e, ledger: append(ledger, a).ledger };
}
export function funnel({ zero = false, nonSyntheticSchemaBranch = false } = {}) {
  const metadata = meta({ isSynthetic: !nonSyntheticSchemaBranch });
  const snapshot = parseRakutenOrder(zero ? zeroBytes : recordsBytes([{ status: "0", id: "synthetic-note", rewards: "100", amount: "10000" },
    { status: "1", id: "synthetic-note", rewards: "200", amount: "20000" }, { status: "2", id: "synthetic-note", rewards: "50", amount: "5000" }]), metadata, { importedAt: IMPORTED_AT });
  return buildFunnelReport({ snapshot, generatedAt: "2026-10-20T01:00:00Z" });
}
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "learning-engine-test-")); t.after(() => rm(root, { recursive: true, force: true }));
  return { root, write: async (name, value) => { const path = join(root, name); await writeFile(path, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); return path; } };
}
