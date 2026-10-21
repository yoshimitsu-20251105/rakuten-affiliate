import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { hash } from "../../market-scanner/model.js";

export const AS_OF = "2026-10-21T00:00:00Z";
export const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url));
export const TARGET = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/rankings/scanner-test.html";
export const HTML = "<!doctype html><title>synthetic scanner LP</title>";
export const source = (sourceId, sourceType, path, more = {}) => ({ sourceId, sourceType, path, provider: "user_verified", evidenceType: "ESTIMATE", sourceReference: `synthetic-${sourceId}`, isSynthetic: true, retrievedAt: "2026-10-01T00:00:00Z", country: "JP", language: "ja", timezone: "Asia/Tokyo", periodStart: "2026-09-01", periodEnd: "2026-09-30", grain: "KEYWORD", scope: "SYNTHETIC", ...more });

export async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "market-scanner-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => { const p = join(root, name); await mkdir(dirname(p), { recursive: true }); await writeFile(p, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)); return p; };
  await write("docs/rankings/scanner-test.html", HTML);
  return { root, write, options: { baseDir: root, repoRoot: root, asOf: AS_OF, generatedAt: AS_OF, runId: "test-run" } };
}

export function funnelReport({ records = true, amount = 500, id = "synthetic-note" } = {}) {
  const scope = { accountScopeId: "synthetic-account", measurementId: id };
  const metric = (value) => ({ value, availability: value === null ? "NOT_AVAILABLE" : "OBSERVED", evidenceType: value === null ? "UNKNOWN" : "FACT", reason: value === null ? "UNVERIFIED" : null, currency: "JPY", scope, validationStatus: "PARTIALLY_VERIFIED" });
  return { schemaVersion: 1, purpose: "AFFILIATE_FUNNEL_MEASUREMENT", sourceBatch: { importId: "synthetic-import", accountScopeId: "synthetic-account", isSynthetic: true, recordCount: records ? 1 : 0, snapshotAsOf: "2026-10-01T00:00:00Z", periodStart: "2026-09-01", periodEnd: "2026-09-30", currency: "JPY" },
    metrics: { revenue: metric(records ? amount : 0), approvedRevenue: metric(records ? amount : 0), conversions: metric(records ? null : 0), epc: metric(null) },
    byMeasurementId: records ? [{ measurementId: id, metrics: { revenue: metric(amount), approvedRevenue: metric(amount), conversions: metric(null) } }] : [], attribution: { channelRevenue: metric(null) } };
}
export const mapping = (overrides = {}) => ({ measurementId: "synthetic-note", accountScopeId: "synthetic-account", targetLP: TARGET, validFrom: "2026-09-01", validThrough: "2026-09-30", evidenceReference: "synthetic-exclusive-mapping", exclusiveToCandidate: true, ...overrides });
export const proof = () => ({
  targetLP: TARGET, affiliateClickMeasurementStatus: "VERIFIED", evidenceId: "synthetic-proof", verifiedAt: "2026-09-30T03:00:00Z", verifiedBy: "synthetic", verifiedPageHash: hash(HTML), ga4PropertyReference: "synthetic-property", expectedEventName: "affiliate_click", applicablePeriod: { start: "2026-10-01", end: "2026-10-31" },
  evidence: { targetLP: TARGET, ga4PropertyReference: "synthetic-property", eventName: "affiliate_click", sent: true, received: true, sentAt: "2026-09-30T02:00:00Z", receivedAt: "2026-09-30T02:01:00Z", sendReference: "synthetic-send", receiveReference: "synthetic-receive", qaEventReference: "synthetic-QA" },
});
