import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { assert, identifier, timestamp, hash, visibleAt, OUTPUT_TYPE, POLICY, POLICY_HASH, METRICS } from "./model.js";
import { validateLedger, validateRoot } from "./store.js";
import { activeRevisions, performanceForExperiment } from "./learning.js";
import { reviewProposal } from "./retry.js";
import { SOURCE_TYPES } from "./sources.js";

export function buildReport(ledger, { asOf = new Date().toISOString(), generatedAt = new Date().toISOString(), runId = randomUUID(),
  codeCommit = null, isSynthetic = false, proposal = null, proposalHash = null, measurementContext = null } = {}) {
  validateLedger(ledger); asOf = timestamp(asOf); generatedAt = timestamp(generatedAt);
  assert(identifier(runId) && typeof isSynthetic === "boolean", "Invalid report run");
  assert(!proposal || proposal.isSynthetic === isSynthetic, "Report/proposal synthetic mismatch");
  const records = (collection) => ledger[collection].filter((r) => r.isSynthetic === isSynthetic && visibleAt(ledger, r, asOf));
  const evidence = new Map(records("evidence").map((r) => [r.recordId, r]));
  const snapshots = records("experimentSnapshots"), ids = [...new Set(snapshots.map((r) => r.experimentId))].sort();
  const decisions = activeRevisions(records("decisions"), asOf), learnings = activeRevisions(records("learnings"), asOf);
  const experimentReviews = ids.map((experimentId) => {
    const history = snapshots.filter((r) => r.experimentId === experimentId), unique = new Map(history.map((r) => [hash(r.raw), r]));
    const current = unique.size === 1 ? [...unique.values()][0] : null;
    const observed = isSynthetic ? { metrics: Object.fromEntries(METRICS.map((k) => [k, { value: null, evidenceType: "UNKNOWN", missingReason: "SYNTHETIC_NOT_REAL_PERFORMANCE" }])) } : performanceForExperiment(ledger, experimentId, asOf);
    return { experimentId, snapshotState: current ? "RECORDED_SNAPSHOT" : "CONFLICT", snapshotRefs: history.map((r) => r.recordId).sort(),
      result: current?.result ?? null, status: current?.status ?? null, sourceDecision: current?.decision ?? null,
      hypothesis: current?.raw.hypothesis ?? null, falsificationCondition: current?.raw.falsificationCondition ?? null,
      thresholds: current ? { success: current.raw.successThreshold ?? null, kill: current.raw.killThreshold ?? null } : null,
      scope: current?.scope ?? null, observations: [...new Set(history.flatMap((r) => r.evidenceRefs))].map((ref) => evidence.get(ref)).filter(Boolean),
      observedPerformance: observed, sourceDeclaredLearnings: current?.sourceDeclaredLearnings ?? [],
      decisions: decisions.filter((g) => g.leaves.some((d) => d.experimentIds.includes(experimentId))),
      learningRefs: learnings.filter((g) => g.leaves.some((l) => l.experimentIds.includes(experimentId))).flatMap((g) => g.leaves.map((r) => r.recordId)),
      reviewFlags: [...(!current ? ["SOURCE_CHANGED_REVIEW_REQUIRED"] : []),
        ...(METRICS.some((k) => observed.metrics[k].value === null) ? ["REVENUE_VALIDATION_MISSING"] : []),
        "SAVED_OBSERVATIONS_NOT_CURRENT_MEASUREMENT_VERIFICATION"],
      canStartExperiment: false };
  });
  const imports = records("sourceImports");
  const sourceStates = imports.map((s) => ({ sourceId: s.sourceId, sourceType: s.sourceType, sourceFileHash: s.sourceFileHash,
    recordedAt: s.recordedAt, retrievedAt: s.retrievedAt ?? null, state: s.sourceState }));
  for (const type of SOURCE_TYPES) if (!imports.some((s) => s.sourceType === type)) sourceStates.push({ sourceId: null, sourceType: type, sourceFileHash: null, state: "NOT_PROVIDED" });
  return {
    schemaVersion: 1, outputType: OUTPUT_TYPE, runId, asOf, generatedAt, codeCommit, isSynthetic, purpose: ledger.purpose,
    ledgerHash: hash(ledger), inputHashes: imports.map((s) => ({ sourceId: s.sourceId, sourceFileHash: s.sourceFileHash })), proposalHash,
    policyVersion: POLICY.version, policyHash: POLICY_HASH, policy: POLICY,
    status: experimentReviews.some((e) => e.reviewFlags.includes("REVENUE_VALIDATION_MISSING") || e.snapshotState === "CONFLICT") ? "COMPLETED_WITH_GAPS" : "COMPLETED",
    experimentReviews, learningIndex: learnings, decisionIndex: decisions,
    proposalReviews: proposal ? [reviewProposal(ledger, proposal, { asOf, measurementContext })] : [],
    accountContext: [...evidence.values()].filter((e) => e.metricOrClaim === "funnel_report").map((e) => ({ evidenceRef: e.recordId, report: e.value,
      attribution: "ACCOUNT_CONTEXT_NOT_ALLOCATED_TO_EXPERIMENTS" })),
    scannerContext: [...evidence.values()].filter((e) => e.metricOrClaim === "scanner_report").map((e) => ({ evidenceRef: e.recordId, report: e.value })),
    scorerContext: [...evidence.values()].filter((e) => e.metricOrClaim === "scorer_report").map((e) => ({ evidenceRef: e.recordId, report: e.value,
      interpretation: "OBSERVED_AND_EXPLORATION_REMAIN_INDEPENDENT" })),
    sourceStates, canStartExperiment: false, requiresStartTimeRevalidation: true,
    limitations: ["Records preserve decisions; this engine never executes SCALE, KILL, IMPROVE, HOLD or experiment starts.",
      "FACT observations, interpretations, falsification assessments and decisions are distinct; FAILED does not mean KILL.",
      "Missing or unattributable earnings remain null. No account allocation, snapshot sums, conversion reconstruction or EPC recalculation.",
      "Learning acceptance does not promote HYPOTHESIS to FACT. Scope and counter evidence must be reviewed before reuse.",
      "Condition satisfaction is advisory. The future Planner must call the existing VERIFIED gate at actual Affiliate note start.",
      "Saved evidence and HTML are not live verification. Existing note vs X and NOTE_NATIVE_MONETIZATION are unchanged.",
      "Synthetic fixtures test contracts, not real earnings or repeatable market performance."] };
}
const safe = (v) => String(v ?? "UNKNOWN").replace(/[\r\n|]/g, " ").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
export function renderMarkdown(r) {
  const lines = ["# Learning Engine v1 — private", "", `Run: ${safe(r.runId)} / asOf: ${r.asOf}`,
    `Status: ${r.status} / synthetic: ${r.isSynthetic}`, "canStartExperiment=false / requiresStartTimeRevalidation=true", "",
    "実験結果・反証・判断・学びを分離して記録します。表示順はID順。判断の実行・公開・投稿は行いません。"];
  for (const e of r.experimentReviews) {
    lines.push("", `## ${safe(e.experimentId)}`, `- status=${safe(e.status)} / result=${safe(e.result)} / recorded decision=${safe(e.sourceDecision)}`,
      `- Snapshot: ${e.snapshotState}`, `- Hypothesis: ${safe(e.hypothesis)}`, `- Falsification condition: ${safe(e.falsificationCondition)}`);
    for (const k of METRICS) { const m = e.observedPerformance.metrics[k]; lines.push(`- ${k}: ${m.value === null ? "UNKNOWN" : m.value} / ${safe(m.missingReason)} / ${safe(m.sourceObservation?.currency ?? m.currency)}`); }
    for (const m of e.observations) lines.push(`- Observation ${safe(m.metricOrClaim)}: ${safe(JSON.stringify(m.value))} / ${m.evidenceType} / observedAt=${safe(m.observedAt)} / ${m.availability}`);
    for (const l of e.sourceDeclaredLearnings) lines.push(`- Legacy learning (source-declared ${l.sourceDeclaredEvidenceType}): ${safe(l.rawValue)}`);
    lines.push(`- Flags: ${e.reviewFlags.join(", ")}`);
  }
  lines.push("", "## Structured learning / counter evidence");
  for (const g of r.learningIndex) for (const l of g.leaves) lines.push(`- ${safe(g.logicalId)} / ${safe(l.revisionId)} / ${g.state} / ${l.reviewStatus}`,
    `  - Claim: ${safe(l.claim.text)} / ${l.claim.evidenceType} / value=${safe(JSON.stringify(l.claim.value))}`,
    `  - Scope: ${safe(JSON.stringify(l.scope))}`, `  - Falsification: ${safe(JSON.stringify(l.falsification))}`,
    `  - Supporting: ${l.evidenceRefs.map(safe).join(", ") || "NONE"} / Counter: ${l.counterEvidenceRefs.map(safe).join(", ") || "NONE"}`,
    `  - Unknowns: ${(l.unknowns ?? []).map(safe).join(" / ") || "NONE_RECORDED"}`,
    `  - Limitations: ${(l.limitations ?? []).map(safe).join(" / ") || "NONE_RECORDED"}`, `  - History: ${g.history.map(safe).join(", ")}`);
  lines.push("", "## Recorded decisions (no actions)");
  for (const g of r.decisionIndex) for (const d of g.leaves) lines.push(`- ${safe(g.logicalId)} / ${g.state}: ${safe(d.decision)} / ${safe(d.reason)}`,
    `  - Raw: ${safe(d.rawDecision)}`, `  - Retry policy: ${safe(JSON.stringify(d.retryPolicy))}`);
  for (const p of r.proposalReviews) {
    lines.push("", `## Proposal ${safe(p.proposalId)} / ${p.status}`, `- WHY_REVISIT: ${safe(p.WHY_REVISIT)}`,
      `- whatChanged: ${safe(p.whatChanged)}`, `- Measurement: ${p.measurement.affiliateClickMeasurementStatus} / ${safe(p.measurement.reason)}`,
      "- canStartExperiment=false (satisfied conditions do not authorize a start)");
    for (const m of p.matches) {
      lines.push(`- ${safe(m.recordId)}: ${m.match} / ${m.retryStatus} / ${m.reason}`);
      for (const c of m.conditions ?? []) lines.push(`  - ${safe(c.conditionId)}: ${c.status} / ${c.reason}`);
    }
  }
  lines.push("", "## Account context (no experiment/channel allocation)");
  for (const e of r.accountContext) lines.push(`- ${safe(e.evidenceRef)}: ${safe(JSON.stringify(e.report.metrics))}`);
  lines.push("", "## Limits", ...r.limitations.map((l) => `- ${l}`));
  return lines.join("\n") + "\n";
}
export async function writeRun(root, report) {
  root = validateRoot(root); assert(identifier(report.runId), "Invalid run ID"); await ensurePrivateDirectory(root);
  const runs = join(root, "runs"); await ensurePrivateDirectory(runs);
  const staging = join(runs, `.pending-${randomUUID()}`), destination = join(runs, report.runId);
  await mkdir(staging, { mode: 0o700 }); let reserved = false;
  try {
    const metadata = { schemaVersion: 1, runId: report.runId, asOf: report.asOf, generatedAt: report.generatedAt, codeCommit: report.codeCommit,
      ledgerHash: report.ledgerHash, inputHashes: report.inputHashes, proposalHash: report.proposalHash, policyVersion: report.policyVersion,
      policyHash: report.policyHash, isSynthetic: report.isSynthetic, status: report.status, outputType: report.outputType, countsAreNotBusinessKpis: true };
    for (const [name, contents] of Object.entries({ "review.json": JSON.stringify(report, null, 2) + "\n", "report.md": renderMarkdown(report), "run-metadata.json": JSON.stringify(metadata, null, 2) + "\n" }))
      await writeFile(join(staging, name), contents, { mode: 0o600, flag: "wx" });
    await mkdir(destination, { mode: 0o700 }); reserved = true;
    await rename(staging, destination); reserved = false;
  } finally { await rm(staging, { recursive: true, force: true }); if (reserved) await rm(destination, { recursive: true, force: true }); }
}
