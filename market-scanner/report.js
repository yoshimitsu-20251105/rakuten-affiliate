import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { loadSources } from "./sources.js";
import { assembleCandidates } from "./candidates.js";
import { attachLinkage } from "./linkage.js";
import { assert, hash, canonical, timestamp, SCHEMA_VERSION, SOURCE_TYPES } from "./model.js";

function material(value) {
  if (Array.isArray(value)) return value.map(material);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["parsedAt", "generatedAt"].includes(key)).map(([key, v]) => [key, material(v)]));
  return value;
}
const digest = (candidate, report) => hash(material({ candidate, evidence: candidate.evidenceRefs.map((id) => report.evidence.find((e) => e.evidenceId === id)) }));

export function compareRuns(current, previous) {
  if (!previous) return null;
  assert(previous.schemaVersion === SCHEMA_VERSION && previous.outputType === "MARKET_CANDIDATES_ONLY" && Array.isArray(previous.candidates) && Array.isArray(previous.evidence), "前回Scanner report形式が不正です");
  const old = new Map(previous.candidates.map((c) => [c.candidateId, c]));
  const changes = current.candidates.map((c) => {
    const before = old.get(c.candidateId); old.delete(c.candidateId);
    return { candidateId: c.candidateId, state: !before ? "NEW" : digest(c, current) === digest(before, previous) ? "UNCHANGED" : "UPDATED",
      addedEvidence: c.evidenceRefs.filter((id) => !before?.evidenceRefs.includes(id)), missingEvidence: (before?.evidenceRefs ?? []).filter((id) => !c.evidenceRefs.includes(id)) };
  });
  for (const c of old.values()) changes.push({ candidateId: c.candidateId, state: "NOT_OBSERVED_THIS_RUN", reason: "NOT_A_KILL_OR_MARKET_DISAPPEARANCE", addedEvidence: [], missingEvidence: c.evidenceRefs });
  return { previousRunId: previous.runId, changes: changes.sort((a, b) => a.candidateId.localeCompare(b.candidateId)) };
}

export async function scanManifest(manifest, { baseDir, repoRoot, asOf = new Date().toISOString(), generatedAt = new Date().toISOString(), runId = randomUUID(), codeCommit = null, previous = null } = {}) {
  asOf = timestamp(asOf, "asOf"); timestamp(generatedAt, "generatedAt");
  assert(/^[a-zA-Z0-9_-]+$/.test(runId), "runIdが不正です");
  const sources = await loadSources(manifest, { baseDir, asOf, parsedAt: generatedAt });
  const assembly = await attachLinkage(assembleCandidates(sources, manifest, { asOf }), sources, { repoRoot, asOf });
  const sourceSummaries = sources.map(({ rows, observations, ...s }) => ({ ...s, rowCount: rows.length + observations.length }));
  const absent = SOURCE_TYPES.filter((t) => !sources.some((s) => s.sourceType === t)).map((sourceType) => ({ sourceType, state: "NOT_PROVIDED" }));
  const report = {
    schemaVersion: SCHEMA_VERSION, outputType: "MARKET_CANDIDATES_ONLY", runId, asOf, generatedAt, codeCommit,
    status: assembly.candidates.length ? "COMPLETED" : "NO_CANDIDATES", targetScope: { country: "JP", language: "ja", note: "Target defaults are not source-country proof" },
    manifestHash: hash(manifest), policy: manifest.freshnessPolicy ?? {}, inputs: [...sourceSummaries, ...absent],
    candidates: assembly.candidates, evidence: [...assembly.evidence.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    runContext: { funnelReports: sources.filter((s) => s.sourceType === "funnel_report").map((s) => ({ sourceId: s.sourceId, isSynthetic: s.isSynthetic, report: s.rows[0], warning: "ACCOUNT_CONTEXT_NOT_CANDIDATE_REVENUE" })) },
    limitations: ["No scoring, ranking, experiment selection/start, content generation, publication or posting.",
      "Offline inputs only; no current SERP, product availability or revenue attribution is inferred.",
      "UNKNOWN/null are never score zero. Missing candidates in a later run are not KILL decisions.",
      "Synthetic inputs are not market/revenue validation. NOTE_NATIVE_MONETIZATION is excluded."],
  };
  report.diff = compareRuns(report, previous);
  return report;
}

const safe = (v) => String(v ?? "UNKNOWN").replace(/[\r\n|]/g, " ").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]);
const metric = (m) => m?.value === null || m?.value === undefined ? `UNKNOWN / ${safe(m?.reason ?? "NOT_OBSERVED")}` : `${safe(m.value)}${m.currency ? ` ${safe(m.currency)}` : ""} / ${safe(m.availability ?? m.evidenceType)}`;
export function renderMarkdown(report) {
  const lines = ["# Market Scanner v1 — private", "", `Run: ${safe(report.runId)} / asOf: ${report.asOf}`, `Status: ${report.status}`, "表示順は安定ID順です。収益順位・実験選択・制作指示ではありません。", "", "## Sources", ""];
  for (const s of report.inputs) lines.push(`- ${safe(s.sourceId ?? s.sourceType)}: ${s.state}${s.sourceFileHash ? ` / SHA-256 ${s.sourceFileHash}` : ""}`);
  for (const c of report.candidates) {
    lines.push("", `## ${safe(c.theme.value)}`, "", `- candidateId: ${c.candidateId}`, `- Synthetic: ${c.isSynthetic}`, `- Theme: ${c.theme.evidenceType}`, `- Keyword: ${c.keywords.map((k) => safe(k.original)).join(" / ")}`, `- Intent: ${safe(c.intent.value)} / ${c.intent.evidenceType}`, `- Purchase intent: ${metric(c.purchaseIntent)}`, "- Demand evidence (source/period specific; no sum):");
    if (!c.demandEvidence.length) lines.push("  - UNKNOWN / DEMAND_NOT_OBSERVED");
    for (const id of c.demandEvidence) {
      const e = report.evidence.find((v) => v.evidenceId === id);
      lines.push(`  - ${e.metricOrClaim}: ${e.value === null ? "UNKNOWN" : safe(e.value)} / ${e.evidenceType} / ${e.availability} / ${safe(e.provider)} / ${safe(e.periodStart)}..${safe(e.periodEnd)} / ${safe(e.reason)}`);
    }
    lines.push(`- Ads competition evidence: ${c.competition.adsBiddingCompetition.length} (SEO難易度ではありません)`, `- Organic competition: ${c.competition.organicSerpEvidence.value === null ? "UNKNOWN" : "出所・observedAt別にJSON参照"}`, `- Seasonality: ${c.seasonality.value === null ? "UNKNOWN" : c.seasonality.value.map((s) => `${safe(s.id)} [${s.peakMonths.join(",")}] ${s.evidenceType}`).join(" / ")}`);
    lines.push(`- Available LP: ${c.availableLPs.length ? c.availableLPs.map((l) => `${safe(l.targetLP)} / local=${safe(l.repositoryPresence.value)} / live=UNKNOWN`).join(" / ") : "UNKNOWN"}`, `- Existing offer: ${c.existingOffers.length ? c.existingOffers.map((o) => `${safe(o.itemCode)} / snapshotDate=${safe(o.snapshotDate)} / current=UNKNOWN`).join(" / ") : "UNKNOWN"}`);
    for (const name of ["approvedRevenue", "revenue", "conversions", "epc"]) lines.push(`- ${name}: ${metric(c.observedRevenueEvidence[name])}`);
    lines.push(`- Measurement: ${c.measurementReadiness.length ? c.measurementReadiness.map((m) => `${safe(m.targetLP)} ${m.affiliateClickMeasurementStatus}`).join(" / ") : "NOT_VERIFIED (no LP mapping)"}`, `- Freshness: ${c.evidenceFreshness.map((f) => `${safe(f.sourceId)} ${f.status} / retrieved=${safe(f.retrievedAt)} / periodEnd=${safe(f.periodEnd)}`).join(" / ")}`, `- Experiments: ${c.relatedExperiments.map((e) => `${safe(e.experimentId)} ${safe(e.status)}`).join(" / ") || "UNKNOWN"}`, `- Signals: ${c.signals.map(safe).join(" / ") || "NONE"}`, `- Review flags: ${c.reviewFlags.map(safe).join(" / ") || "NONE"}`, `- Counter evidence: ${c.counterEvidence.map(safe).join(" / ") || "NOT_RECORDED"}`, `- Unknowns: ${c.unknowns.map(safe).join(" / ") || "NONE_RECORDED"}`);
  }
  if (report.diff) lines.push("", "## Previous run comparison", "", ...report.diff.changes.map((c) => `- ${c.candidateId}: ${c.state} (evidence +${c.addedEvidence.length}/-${c.missingEvidence.length})`));
  lines.push("", "## Limitations", "", ...report.limitations.map((s) => `- ${s}`));
  return lines.join("\n") + "\n";
}

export async function writeRun(root, report) {
  await ensurePrivateDirectory(root);
  assert(/^[a-zA-Z0-9_-]+$/.test(report.runId), "runIdが不正です");
  const staging = join(root, `.pending-${randomUUID()}`), destination = join(root, report.runId);
  await mkdir(staging, { mode: 0o700 });
  try {
    for (const [name, value] of Object.entries({ "candidates.json": JSON.stringify(report, null, 2) + "\n", "report.md": renderMarkdown(report), "run-metadata.json": JSON.stringify({ schemaVersion: SCHEMA_VERSION, runId: report.runId, asOf: report.asOf, generatedAt: report.generatedAt, codeCommit: report.codeCommit, status: report.status, manifestHash: report.manifestHash, policy: report.policy, inputs: report.inputs, candidateCount: report.candidates.length, candidateCountIsNotBusinessKpi: true }, null, 2) + "\n" })) await writeFile(join(staging, name), value, { flag: "wx", mode: 0o600 });
    await mkdir(destination, { mode: 0o700 });
    try { await rename(staging, destination); }
    catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
