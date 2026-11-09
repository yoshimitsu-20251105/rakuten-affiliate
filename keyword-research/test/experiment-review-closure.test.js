import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hash, emptyLedger } from "../../learning-engine/model.js";
import { append, validateLedger } from "../../learning-engine/store.js";
import { classifyRegistry } from "../../experiment-selector/gates.js";
import { validateReviewClosures } from "./experiment-review-helpers.js";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const read = async p => JSON.parse(await readFile(new URL(`../../${p}`, import.meta.url), "utf8"));
const dir = "strategy/experiment-reviews/2026-11-09/";
const before = JSON.parse(execFileSync("git", ["show", "0376dd712783b7c112f5065f2c7bba05a4b7a6a0:strategy/experiments.json"], { cwd: repo, encoding: "utf8" }));
const after = await read("strategy/experiments.json"), bundle = await read(dir + "registry-closures.json"), evidence = await read(dir + "evidence.json");

test("Four explicitly authorized closures preserve objectives, old metrics and the two historical reviews", () => {
  validateReviewClosures(before, after, bundle, evidence);
});
for (const field of ["hypothesis", "targetUrls", "successThreshold", "killThreshold", "trafficSource", "baseline"])
  test(`Closure cannot exempt protected experiment ${field}`, () => {
    const bad = structuredClone(after); bad.items[2][field] = { unauthorizedChange: true };
    assert.throws(() => validateReviewClosures(before, bad, bundle, evidence));
  });
test("Source hash changes and past metric rewrites fail closed", () => {
  const bad = structuredClone(bundle); bad.closures[0].finalRecordHash = "0".repeat(64);
  assert.throws(() => validateReviewClosures(before, after, bad, evidence));
  const other = structuredClone(after); other.items[2].metrics[0].value = 999;
  assert.throws(() => validateReviewClosures(before, other, bundle, evidence));
});
test("Post-period senior-cat impressions do not replace primary impressions", () => {
  const bad = structuredClone(evidence); bad.reviews.find(r => r.experimentId.endsWith("senior-cat-food")).evidence.primary.gscImpressions.value = 9;
  assert.throws(() => validateReviewClosures(before, after, bundle, bad));
});
test("NO_ROWS affiliate click and unprovided GA4 remain null", () => {
  const bad = structuredClone(evidence); bad.reviews[0].evidence.ga4.affiliateClick.value = 0;
  assert.throws(() => validateReviewClosures(before, after, bundle, bad));
  for (const r of evidence.reviews.filter(r => r.experimentId.startsWith("exp-2026-10-05"))) {
    assert.equal(r.evidence.ga4.sessions, null); assert.equal(r.evidence.primary.gscClicks.value, null);
  }
});
test("Current registry classification preserves the revenue group and releases its slot only via terminal registry state", () => {
  const rows = classifyRegistry({ experimentsSnapshot: after, hashes: { experimentsSnapshot: hash(after) },
    selectionContext: { experimentClassifications: [] }, asOf: evidence.recordedAt });
  assert(rows.every(r => r.experimentClass !== "UNKNOWN"));
  assert.equal(rows.filter(r => r.status === "RUNNING" && r.monetizationGroup === "AFFILIATE_MONETIZATION").length, 0);
  assert.equal(rows.find(r => r.experimentId.includes("note-vs-x")).monetizationGroup, "AFFILIATE_MONETIZATION");
});
test("Learning evidence is sealed, append-only and idempotent; accepted revisions name their parents", async () => {
  const additions = await read(dir + "learning-evidence.json"), ledger = append(emptyLedger(), additions).ledger;
  validateLedger(ledger); assert.equal(append(ledger, additions).status, "DUPLICATE");
  const spec = await read(dir + "learning-review.json"), receipt = await read(dir + "learning-append-receipt.json");
  assert.equal(receipt.oldRecordsUnchanged, true);
  assert.equal(spec.learnings.length, 5);
  for (const r of spec.learnings.filter(r => !r.logicalId.startsWith("closed-seo-review:"))) assert(r.supersedesRevisionId);
  const note = spec.learnings.find(r => r.logicalId.includes("note-vs-x"));
  assert.equal(note.retryConditions.length, 4); assert(note.retryConditions.every(c => c.required));
  assert(note.retryConditions.some(c => c.type === "MEASUREMENT_VERIFIED"));
});
test("Saved re-selection is tied to registry bytes, keeps independent missing scores and no action authority", async () => {
  const r = await read(dir + "reselection-summary.json");
  assert.equal(r.registryRawHash, hash(await readFile(new URL("../../strategy/experiments.json", import.meta.url))));
  assert.equal(r.comparison.length, 3); assert.equal(r.selector.recommendationCount, 0);
  assert.equal(r.planner.status, "BLOCKED"); assert.equal(r.planner.plans, 0); assert.equal(r.canStartExperiment, false);
  for (const c of r.comparison) { assert.equal(c.exploration.totalScore, null); assert.equal(c.observedPerformance.revenue.value, null); }
  assert.equal(r.recommendation.formalSelectorRecommendationCount, 0);
  assert.equal(r.recommendation.role, "RESEARCH_AND_MEASUREMENT_PREPARATION_PRIORITY_NOT_SELECTOR_RECOMMENDATION");
});
