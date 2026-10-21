import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { assert, hash, timestamp, identifier, validateInputs, SCHEMA_VERSION, OUTPUT_TYPE } from "./model.js";
import { POLICY, POLICY_HASH, COMPONENTS, PERFORMANCE_METRICS } from "./policy.js";
import { assessObservedPerformance, assessExploration } from "./assessment.js";
import { compareObservedPerformance, compareExploration } from "./comparison.js";

export const DEFAULT_ROOT = fileURLToPath(new URL("../reports/opportunity-scorer/", import.meta.url));
function material(value) {
  if (Array.isArray(value)) return value.map(material);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["parsedAt", "generatedAt"].includes(key)).map(([key, v]) => [key, material(v)]));
  return value;
}

export function compareRuns(current, previous) {
  if (!previous) return null;
  assert(previous.schemaVersion === SCHEMA_VERSION && previous.outputType === OUTPUT_TYPE && Array.isArray(previous.assessments) && Array.isArray(previous.observedPerformance), "unsupported previous Scorer report");
  const old = new Map(previous.assessments.map((row) => [row.assessmentId, row]));
  const changes = current.assessments.map((row) => {
    const before = old.get(row.assessmentId); old.delete(row.assessmentId);
    const digest = (r, report) => hash(material({ assessment: r, performance: report.observedPerformance.find((p) => p.candidateId === r.candidateId) }));
    return { assessmentId: row.assessmentId, state: !before ? "NEW" : digest(row, current) === digest(before, previous) ? "UNCHANGED" : "UPDATED",
      rankingComparable: Boolean(before && before.comparisonGroup && before.comparisonGroup === row.comparisonGroup),
      missingEvidence: before ? [...new Set(COMPONENTS.flatMap((key) => before.components[key].evidenceRefs))].filter((id) => !COMPONENTS.some((key) => row.components[key].evidenceRefs.includes(id))) : [],
      addedEvidence: [...new Set(COMPONENTS.flatMap((key) => row.components[key].evidenceRefs))].filter((id) => !before || !COMPONENTS.some((key) => before.components[key].evidenceRefs.includes(id))) };
  });
  for (const row of old.values()) changes.push({ assessmentId: row.assessmentId, state: "NOT_OBSERVED_THIS_RUN", reason: "NOT_A_MARKET_FAILURE_OR_KILL", rankingComparable: false, addedEvidence: [], missingEvidence: [...new Set(COMPONENTS.flatMap((key) => row.components[key].evidenceRefs))] });
  return { previousRunId: previous.runId, policyChanged: previous.policyHash !== current.policyHash, asOfChanged: previous.asOf !== current.asOf,
    changes: changes.sort((a, b) => a.assessmentId.localeCompare(b.assessmentId)) };
}

export function buildReport(scanner, { context = null, scannerHash = hash(scanner), contextHash = context ? hash(context) : null, asOf = new Date().toISOString(), generatedAt = new Date().toISOString(), runId = randomUUID(), codeCommit = null, previous = null } = {}) {
  asOf = timestamp(asOf, "asOf"); generatedAt = timestamp(generatedAt, "generatedAt");
  assert(identifier(runId), "invalid runId");
  const index = validateInputs(scanner, context);
  assert(Date.parse(scanner.asOf) <= Date.parse(asOf), "Scanner snapshot is after asOf");
  if (context?.scannerFileHash != null) assert(context.scannerFileHash === scannerHash, "Scanner file hash mismatch");
  const observedPerformance = compareObservedPerformance(assessObservedPerformance(scanner, index, { asOf }));
  const assessments = compareExploration(assessExploration(scanner, index, { asOf, scannerHash, contextPurpose: context?.purpose }), index);
  const report = { schemaVersion: SCHEMA_VERSION, outputType: OUTPUT_TYPE, runId, asOf, generatedAt, codeCommit,
    scannerRunId: scanner.runId, scannerFileHash: scannerHash, contextHash, policy: POLICY, policyHash: POLICY_HASH,
    status: !assessments.length ? "NO_CANDIDATES" : assessments.some((r) => r.exploration.totalScore === null) || observedPerformance.some((r) => PERFORMANCE_METRICS.some((key) => r.metrics[key].value === null)) ? "COMPLETED_WITH_GAPS" : "COMPLETED",
    observedPerformance, assessments,
    limitations: ["Observed FACT performance and HYPOTHESIS exploration are independent comparisons, not revenue forecasts.",
      "Unknowns stay null. Account snapshots are not allocated to candidates. EPC and Conversions are not reconstructed.",
      "This CLI never selects, starts, stops or scales experiments, generates content, publishes or posts.",
      "Measurement is a saved Scanner snapshot; the new Affiliate note start gate must be revalidated by the Planner.",
      "Synthetic fixtures validate software contracts, not real nonzero Rakuten earnings or market profitability."] };
  report.diff = compareRuns(report, previous);
  return structuredClone(report);
}

export async function readInputs(scannerPath, contextPath = null) {
  const scannerBytes = await readFile(scannerPath);
  const contextBytes = contextPath ? await readFile(contextPath) : null;
  const parse = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
  return { scanner: parse(scannerBytes), scannerHash: hash(scannerBytes), context: contextBytes ? parse(contextBytes) : null, contextHash: contextBytes ? hash(contextBytes) : null };
}

const safe = (value) => String(value ?? "UNKNOWN").replace(/[\r\n|]/g, " ").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]);
export function renderMarkdown(report) {
  const lines = ["# Opportunity Scorer v1 — private", "", `Run: ${safe(report.runId)} / asOf: ${report.asOf}`, `Status: ${report.status}`, `Scanner: ${safe(report.scannerRunId)} / SHA-256 ${report.scannerFileHash}`, "表示順は安定ID順。実績比較と探索比較は独立し、実験選択・開始の指示ではありません。", "", "## Observed Performance (FACT only)"];
  for (const row of report.observedPerformance) {
    lines.push("", `### ${safe(row.candidateId)}`, `- performanceRank: ${safe(row.performanceRank)} / comparisonDepth: ${row.comparisonDepth.join(", ") || "NONE"}`);
    for (const key of PERFORMANCE_METRICS) {
      const m = row.metrics[key];
      lines.push(`- ${key}: ${m.value === null ? "UNKNOWN" : `${m.value} ${safe(m.currency)}`} / ${safe(m.evidenceType)} / ${safe(m.missingReason)}`);
    }
    lines.push(`- Comparison: ${row.comparisonReasons.map(safe).join(" / ") || "COMPARABLE_RECORDED_TOTALS_NOT_CAUSAL_EFFECT"}`);
  }
  lines.push("", "## Exploration (HYPOTHESIS, not Revenue prediction)");
  for (const row of report.assessments) {
    lines.push("", `### ${safe(row.theme?.value ?? row.candidateId)} / ${safe(row.contextId)}`, `- Synthetic: ${row.isSynthetic}`, `- totalScore: ${row.exploration.totalScore === null ? "UNKNOWN" : `${row.exploration.totalScore}/100`}`, `- explorationRank: ${safe(row.explorationRank)}`);
    for (const key of COMPONENTS) {
      const c = row.components[key];
      lines.push(`- ${key}: ${c.value === null ? "UNKNOWN" : c.value}/${c.maxScore} / ${c.evidenceType}`,
        `  - evidenceRefs: ${c.evidenceRefs.map(safe).join(", ") || "NONE"}`, `  - source: ${safe(JSON.stringify(c.source))}`,
        `  - period: ${safe(JSON.stringify(c.period))}`, `  - freshness: ${safe(JSON.stringify(c.freshness))}`,
        `  - reason: ${safe(c.reason)} / missingReason: ${safe(c.missingReason)}`);
    }
    lines.push(`- Comparison: ${row.comparisonReasons.map(safe).join(" / ") || "COMPARABLE_HYPOTHESES"}`, `- Measurement: ${row.measurementReadiness.map((m) => `${safe(m.targetLP)} ${m.affiliateClickMeasurementStatus}`).join(" / ") || "NOT_VERIFIED (no saved LP proof)"}`,
      "- canStartExperiment: false / requiresStartTimeRevalidation: true", `- Constraints: ${row.constraints.map(safe).join(" / ") || "NONE_RECORDED"}`, `- Counter evidence: ${row.counterEvidence.map(safe).join(" / ") || "NOT_RECORDED"}`, `- Next evidence: ${safe(JSON.stringify(row.nextEvidenceNeeded))}`);
  }
  if (report.diff) lines.push("", "## Previous run", ...report.diff.changes.map((r) => `- ${r.assessmentId}: ${r.state}`));
  lines.push("", "## Limitations", ...report.limitations.map((s) => `- ${s}`));
  return lines.join("\n") + "\n";
}

export function validateOutputRoot(root) {
  const path = resolve(root), tempRelative = relative(resolve(tmpdir()), path);
  assert(path === resolve(DEFAULT_ROOT) || (tempRelative && !tempRelative.startsWith("..") && !isAbsolute(tempRelative)), "output must be the private Scorer root or a dedicated OS temporary directory");
  return path;
}

export async function writeRun(root, report) {
  root = validateOutputRoot(root);
  await ensurePrivateDirectory(root);
  assert(identifier(report.runId), "invalid runId");
  const staging = join(root, `.pending-${randomUUID()}`), destination = join(root, report.runId);
  await mkdir(staging, { mode: 0o700 });
  try {
    const metadata = { schemaVersion: SCHEMA_VERSION, runId: report.runId, asOf: report.asOf, generatedAt: report.generatedAt, codeCommit: report.codeCommit,
      status: report.status, scannerRunId: report.scannerRunId, scannerFileHash: report.scannerFileHash, contextHash: report.contextHash,
      policy: report.policy, policyHash: report.policyHash, assessmentCount: report.assessments.length, assessmentCountIsNotBusinessKpi: true };
    for (const [name, contents] of Object.entries({ "assessments.json": JSON.stringify(report, null, 2) + "\n", "report.md": renderMarkdown(report), "run-metadata.json": JSON.stringify(metadata, null, 2) + "\n" })) await writeFile(join(staging, name), contents, { flag: "wx", mode: 0o600 });
    await mkdir(destination, { mode: 0o700 });
    try { await rename(staging, destination); }
    catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
