import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { assert, identifier, timestamp, hash, OUTPUT_TYPE } from "./model.js";
import { POLICY, POLICY_HASH } from "./policy.js";
import { validateInputsBundle } from "./sources.js";
import { select } from "./selection.js";

export const DEFAULT_ROOT = fileURLToPath(new URL("../reports/experiment-selector/", import.meta.url));
export function buildReport(input, { runId = randomUUID(), generatedAt = new Date().toISOString(), codeCommit = null } = {}) {
  assert(identifier(runId), "Invalid run ID"); timestamp(generatedAt);
  // Direct callers receive exactly the same provenance/contract validation as CLI callers.
  const validated = validateInputsBundle(input, input.hashes, input);
  validated.measurementContexts = input.measurementContexts ?? {};
  const result = select(validated);
  return structuredClone({ schemaVersion: 1, outputType: OUTPUT_TYPE, purpose: input.purpose, isSynthetic: input.isSynthetic,
    runId, asOf: validated.asOf, generatedAt: timestamp(generatedAt), codeCommit, inputHashes: input.hashes, learningLedgerHash: hash(input.learningLedger), policy: input.selectionContext.policy,
    fixedPolicy: POLICY, policyHash: POLICY_HASH, selectionTrack: input.selectionContext.policy.selectionTrack, ...result,
    status: result.recommendations.length ? "RECOMMENDATION_ONLY" : "NO_RECOMMENDATION", recommendationCount: result.recommendations.length,
    selectionStatus: result.recommendations.length ? "SELECTED_FOR_REVIEW" : "NO_SELECTION", selectedProposal: result.recommendations[0] ?? null,
    observedPerformance: input.scorerReport.observedPerformance, explorationAssessments: input.scorerReport.assessments,
    canStartExperiment: false, requiresStartTimeRevalidation: true,
    limitations: ["No experiment state changes, publication, posts, SCALE or KILL. A recommendation is not permission to start.",
      "Unknown/null is never zero. FACT performance and HYPOTHESIS exploration are separate, without implicit fallback or combined rank.",
      "Registry completeness covers this supplied Affiliate registry only; unregistered/external activity is not discovered.",
      "Saved HTML/proofs do not verify live traffic. Recheck measurement, retry and group capacity at start; no slot is reserved.",
      "Candidate Revenue is not attributed to a proposed channel. Current offer price/availability remains unknown when unobserved.",
      "Synthetic software fixtures are not evidence of real nonzero Rakuten results or profitability."] });
}
const safe = (v) => String(v ?? "UNKNOWN").replace(/[\r\n|]/g, " ").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]);
export function renderMarkdown(r) {
  const lines = ["# Experiment Selector v1 — private", "", `Run: ${safe(r.runId)} / asOf: ${r.asOf}`, `Track: ${r.selectionTrack}`,
    `Recommendations: ${r.recommendationCount} / ${safe(r.selectionReason)}`, "canStartExperiment: false; no capacity reservation.", "", "## Concurrency"];
  for (const c of r.concurrency) lines.push(`- ${safe(c.monetizationGroup)}: ${c.status} / known RUNNING ${c.knownRunningCount} / limit ${safe(c.limit)} / ${c.reason}`);
  for (const e of r.runningClassifications) lines.push(`- ${safe(e.experimentId)}: ${e.experimentClass} / ${safe(e.monetizationGroup)} / ${e.reason}`);
  lines.push("", "## All candidates (stable input order; not a rank)");
  for (const c of r.candidates) {
    lines.push(`- ${safe(c.candidateId)}: ${c.eligibility}; selected=${c.selected}; ${safe(c.selectionReason ?? c.rejectionReason.join(", "))}`,
      `  - retry=${c.retryStatus}; measurement=${c.measurementGateStatus}; concurrency=${c.concurrencyStatus}`);
    for (const p of c.proposals) lines.push(`  - ${safe(p.proposalId)}: ${p.eligibility} / ${safe(p.selectionReason ?? p.rejectionReason.join(", "))}`,
      `    - Evidence: ${safe(JSON.stringify(p.evidenceRefs))}; counterEvidence: ${safe(JSON.stringify(p.counterEvidence))}`);
  }
  lines.push("", "## Observed Performance (FACT only; missing stays null)");
  for (const p of r.observedPerformance) lines.push(`- ${safe(p.candidateId)}: ${safe(JSON.stringify(p.metrics))}`);
  lines.push("", "## Exploration (HYPOTHESIS; independent of Revenue)");
  for (const p of r.explorationAssessments) lines.push(`- ${safe(p.assessmentId)}: total=${safe(p.exploration.totalScore)}; ${safe(JSON.stringify(p.components))}`);
  lines.push("", "## Limitations", ...r.limitations.map((v) => `- ${v}`)); return lines.join("\n") + "\n";
}
export function validateOutputRoot(root) {
  const path = resolve(root), rel = relative(resolve(tmpdir()), path);
  assert(path === resolve(DEFAULT_ROOT) || rel && !rel.startsWith("..") && !isAbsolute(rel), "Output must be private Selector root or dedicated OS temporary directory"); return path;
}
export async function writeRun(root, report) {
  root = validateOutputRoot(root); await ensurePrivateDirectory(root); assert(identifier(report.runId), "Invalid run ID");
  const staging = join(root, `.pending-${randomUUID()}`), destination = join(root, report.runId);
  await mkdir(staging, { mode: 0o700 });
  try {
    const metadata = { schemaVersion: 1, runId: report.runId, asOf: report.asOf, generatedAt: report.generatedAt, codeCommit: report.codeCommit,
      inputHashes: report.inputHashes, policyHash: report.policyHash, status: report.status, recommendationCount: report.recommendationCount, canStartExperiment: false };
    for (const [name, value] of Object.entries({ "selection.json": report, "run-metadata.json": metadata, "report.md": renderMarkdown(report) }))
      await writeFile(join(staging, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await mkdir(destination, { mode: 0o700 });
    try { await rename(staging, destination); } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
