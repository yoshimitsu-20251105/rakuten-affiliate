import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { buildRadar, collectRadarSignals, radarScorerContext } from "../../revenue-foundation/radar.js";
import { buildLegacyInventory } from "../../revenue-foundation/inventory.js";
import { POLICY_HASH } from "../../opportunity-scorer/policy.js";
import { data, run } from "./opportunity-scorer-helpers.js";

const asOf = "2026-10-21T00:00:00.000Z";
const signal = { source: "public-market", sourceRef: "synthetic:weekly-index", evidenceType: "ESTIMATE",
  observedAt: asOf, previous: 0, current: 5 };
const candidate = { opportunityId: "winter", topic: "Winter insulation", category: "home",
  keywords: ["window insulation"], observedAt: asOf, isSynthetic: true,
  seasonality: { peakMonths: [12, 1], sourceRef: "synthetic:season", evidenceType: "HYPOTHESIS" }, signals: [signal] };
const radar = (candidates, at = asOf) => buildRadar({ schemaVersion: 1, asOf: at, candidates });

test("Radar validates its schema and is deterministic with distinct seasonality", () => {
  const result = radar([candidate]);
  assert.deepEqual(result, radar([structuredClone(candidate)]));
  assert.deepEqual(result.opportunities[0].seasonality.peakMonths, [1, 12]);
  assert.equal(result.opportunities[0].demandDirection, "UP");
  assert.throws(() => radar([{ ...candidate, keywords: [] }]), /candidate/);
  assert.throws(() => radar([{ ...candidate, signals: [{ ...signal, evidenceType: "FACT" }] }]), /Synthetic/);
});

test("Radar expires old opportunities, treats missing as UNKNOWN, and evaluates actual zeros", () => {
  const later = "2026-11-04T00:00:00.000Z";
  const zero = { ...candidate, opportunityId: "zero", observedAt: later,
    signals: [{ ...signal, observedAt: later, previous: 0, current: 0 }] };
  const missing = { ...zero, opportunityId: "missing", signals: [{ ...zero.signals[0], current: null }] };
  const rows = radar([candidate, missing, zero], later).opportunities;
  assert.deepEqual(rows.map((r) => [r.opportunityId, r.demandDirection, r.freshness]), [
    ["zero", "FLAT", "FRESH"], ["missing", "UNKNOWN", "FRESH"], ["winter", "UNKNOWN", "EXPIRED"],
  ]);
  assert.equal(rows[1].confidence, null);
  assert.equal(rows[2].expiresAt, later);
});

test("Radar providers return NOT_AVAILABLE without invoking a credentialed provider", async () => {
  const absent = await collectRadarSignals({ id: "google-trends", requiresCredentials: true, isSynthetic: false,
    read() { assert.fail("Unavailable provider must not run"); } }, {});
  assert.deepEqual(absent, { provider: "google-trends", status: "NOT_AVAILABLE", reason: "CREDENTIALS_ABSENT", signals: [] });
  const available = await collectRadarSignals({ id: "public-market", requiresCredentials: false, isSynthetic: true,
    read: async () => [signal] }, {});
  assert.equal(available.status, "AVAILABLE");
  assert.equal(available.signals[0].isSynthetic, true);
});

test("Radar supplies the existing Scorer with a linked 15-point demand hypothesis", async () => {
  const fixture = await data();
  const { scanner } = fixture;
  const linked = scanner.candidates.find((c) => c.demandEvidence.length);
  const saved = scanner.evidence.find((e) => e.evidenceId === linked.demandEvidence[0]);
  const signalWithLink = { ...signal, source: saved.provider, current: saved.value,
    observedAt: saved.retrievedAt, scannerEvidenceRef: saved.evidenceId };
  const input = { ...candidate, scannerCandidateId: linked.candidateId, signals: [signalWithLink] };
  const evaluate = (signals) => {
    const report = buildRadar({ schemaVersion: 1, asOf, maxAgeDays: 30, candidates: [{ ...input, signals }] });
    const context = radarScorerContext(scanner, report);
    assert.equal(context.policyHash, POLICY_HASH);
    return run({ scanner, context }).assessments.find((row) => row.candidateId === linked.candidateId).components.demand;
  };
  assert.equal(evaluate([signalWithLink]).value, 15);
  assert.equal(evaluate([{ ...signalWithLink, current: signalWithLink.current + 1 }]).value, null);
  assert.equal(evaluate([{ ...signalWithLink, current: null }]).value, null);
  assert.equal(evaluate([{ ...signalWithLink, observedAt: asOf }]).value, null);
});

test("Legacy inventory covers the 408 product pages and preserves unknown live status", async () => {
  const result = await buildLegacyInventory(fileURLToPath(new URL("../../docs/", import.meta.url)));
  assert.equal(result.pageCount, 408);
  assert.equal(result.applyChanges, false);
  assert.equal(new Set(result.inventory.map((page) => page.pagePath)).size, 408);
  assert.ok(result.inventory.some((page) => page.duplicateCluster?.memberCount > 1 &&
    page.recommendedDisposition === "CONSOLIDATE" && page.cannibalizationRisk === "POSSIBLE"));
  assert.ok(result.inventory.every((page) => page.searchConsole.availability === "UNKNOWN" &&
    page.searchConsole.clicks === null && page.affiliateProductValidity.destinationValidity === "UNKNOWN"));
});
