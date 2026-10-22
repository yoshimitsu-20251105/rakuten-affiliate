import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { validateBundle } from "./sources.js";
import { channelProfile } from "./channels.js";
import { identifiers, measurementBinding } from "./tracking.js";
import { evaluateGates, currentCapacity } from "./gates.js";
import { assert, hash, canonical, timestamp, identifier, ref, reason, statusFor, OUTPUT_TYPE, OPERATIONS, POLICY, POLICY_HASH, PROTOCOL_FIELDS } from "./model.js";

export const DEFAULT_ROOT = fileURLToPath(new URL("../reports/acquisition-planner/", import.meta.url));
export function buildReport(input, { runId = null, generatedAt = input.asOf, codeCommit = null } = {}) {
  const b = validateBundle(input), p = b.selectedProposal; timestamp(generatedAt);
  const plans = [], commonReasons = [], capacity = currentCapacity(b);
  if (!p) commonReasons.push(reason("NO_SELECTOR_RECOMMENDATION", "BLOCKED", "selectorReport", "/recommendations"));
  else {
    const profile = channelProfile(p.channel, b.planningContext.channelProfiles), gates = evaluateGates(b, profile);
    const proposed = b.planningContext.plan ?? { experimentId: null, candidateId: p.candidateId, channel: p.channel, targetLP: p.targetLP };
    const tracking = identifiers(proposed, profile, b.currentStateManifest.identityIndex, b.current.experimentsSnapshot, b.asOf), binding = measurementBinding(b, p);
    const reasons = [...gates.reasons, ...tracking.reasons, ...binding.reasons], unique = [...new Map(reasons.map((r) => [canonical(r), r])).values()];
    const evidenceRefs = [ref(b, "selectorReport", "/selectedProposal", "HYPOTHESIS"), ref(b, "original.selectionContext", "/proposals", "HYPOTHESIS"),
      ref(b, "current.selectionContext", "/"), ref(b, "current.learningLedger", "/"), ref(b, "current.experimentsSnapshot", "/items"), ref(b, "planningContext", "/", "HYPOTHESIS"),
      ref(b, "currentStateManifest", "/identityIndex"), ...Object.keys(b.hashes).filter((k) => k.startsWith("current.html.") || k.startsWith("current.order")).map((k) => ref(b, k, "/"))];
    const plan = { schemaVersion: 1, outputType: OUTPUT_TYPE, planId: tracking.planId, experimentId: proposed.experimentId ?? null, experimentRegistrationStatus: "PROPOSED_NOT_REGISTERED",
      candidateId: p.candidateId, selectedProposalId: p.proposalId, selectorRunId: b.selectorReport.runId, purpose: p.purpose, channel: p.channel, targetLP: p.targetLP,
      channelProfileVersion: profile?.version ?? null, channelProfile: profile, isSynthetic: b.isSynthetic,
      ...Object.fromEntries(PROTOCOL_FIELDS.map((k) => [k, proposed[k] ?? null])), ...tracking, ...binding,
      fixedVariables: gates.fixedVariables, changedVariable: proposed.changedVariable ?? null,
      affiliateClickMeasurementStatus: gates.measurement.affiliateClickMeasurementStatus, measurementVerification: gates.measurementVerification,
      selectorFreshness: { selectorAsOf: b.selectorReport.asOf, evaluatedAt: b.asOf, reportSourceHash: b.hashes.selectorReport,
        originalVerificationComplete: !b.sourceIssues.some((r) => r.code === "ORIGINAL_VERIFICATION_SNAPSHOT_MISSING"), comparisonPremise: gates.comparisonPremise },
      retryReview: gates.retryReview, historyReview: gates.historyReview, counterEvidence: gates.counterEvidence,
      concurrencyReview: gates.concurrencyReview, interferenceReview: gates.interferenceReview,
      publishChecklist: [...gates.confirmations.filter((c) => c.checkId === "CHANNEL_HANDOFF"),
        { checkId: "HUMAN_CONTENT_AND_LINK_REVIEW", phase: "PRE_PUBLISH", status: "PENDING_EXECUTION", requiredForPlanReadiness: false },
        { checkId: "REVALIDATE_ALL_GATES_BEFORE_ACTION", phase: "PRE_PUBLISH", status: "PENDING_EXECUTION", requiredForPlanReadiness: false },
        { checkId: "RECORD_ACTUAL_PUBLICATION_EVIDENCE", phase: "POST_PUBLISH", status: "PENDING_EXECUTION", requiredForPlanReadiness: false }],
      measurementChecklist: [...gates.confirmations.filter((c) => c.checkId === "TRAFFIC_GRAIN"),
        { checkId: "AFFILIATE_CLICK", phase: "PLAN", status: gates.measurement.affiliateClickMeasurementStatus === "VERIFIED" ? "PASS" : "UNKNOWN", requiredForPlanReadiness: p.purpose === "AFFILIATE_NOTE_ACQUISITION" || Boolean(proposed.requiredMetrics?.some((k) => ["epc", "affiliateClicks"].includes(k))) },
        { checkId: "AFFILIATE_LINK_BINDING", phase: "PLAN", status: binding.affiliateMeasurementIdStatus === "VERIFIED_EXISTING" ? "PASS" : "UNKNOWN", requiredForPlanReadiness: true }],
      theme: b.original.index.candidates.get(p.candidateId).theme, offerRefs: p.itemCodes, category: p.scope.category ?? null, priceBand: p.scope.priceBand ?? null,
      planStatus: statusFor(unique), blockingReasons: unique, evidenceRefs,
      unknowns: [...unique.filter((r) => r.status === "MANUAL_REVIEW_REQUIRED").map((r) => ({ ...r, value: null, evidenceType: "UNKNOWN" })),
        { code: "UNOBSERVED_OUTCOMES_REMAIN_NULL", value: null, evidenceType: "UNKNOWN" }, { code: "LIVE_AVAILABILITY_AND_CURRENT_PRICE_NOT_INFERRED", value: null, evidenceType: "UNKNOWN" }],
      ...OPERATIONS, requiresStartTimeRevalidation: true };
    // Internal reason arrays have been merged into the public complete reason list.
    delete plan.reasons;
    if (p.channel === "note") plan.affiliateNotePostPlan = { experimentId: plan.experimentId, candidateId: p.candidateId, purpose: p.purpose, channel: "note", targetLP: p.targetLP,
      ...Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "affiliateMeasurementId", "affiliateMeasurementIdStatus", "affiliateClickMeasurementStatus", "contentPurpose", "contentPattern", "titlePattern", "ctaPattern"].map((k) => [k, plan[k]])),
      measurementVerification: plan.measurementVerification, publishedAt: null, postUrl: null, publicationEvidenceStatus: "NOT_RECORDED",
      impressions: null, views: null, likes: null, outboundLPClicks: null, ...OPERATIONS };
    plan.planRevisionHash = hash(plan); plans.push(plan);
  }
  const allReasons = [...commonReasons, ...plans.flatMap((p) => p.blockingReasons)];
  runId ??= `run-${hash({ inputs: b.hashes, asOf: b.asOf, policyHash: POLICY_HASH })}`; assert(identifier(runId), "Invalid run ID");
  return { schemaVersion: 1, outputType: OUTPUT_TYPE, runId, asOf: b.asOf, generatedAt: timestamp(generatedAt), codeCommit, purpose: b.purpose, isSynthetic: b.isSynthetic,
    inputHashes: b.hashes, learningLedgerHash: hash(b.current.learningLedger), policy: b.planningContext.policy, fixedPolicy: POLICY, policyHash: POLICY_HASH,
    selectorRunId: b.selectorReport.runId, selectorAsOf: b.selectorReport.asOf, selectedProposalId: p?.proposalId ?? null, plans,
    planStatus: statusFor(allReasons), blockingReasons: allReasons, concurrencyReview: capacity, ...OPERATIONS, requiresStartTimeRevalidation: true,
    limitations: ["READY is plan completeness at asOf, not authorization to start, publish, post or modify assets. No reservation is made.",
      "Planner revalidates the original recommendation and current premises, and never selects a replacement.",
      "VERIFIED_EXISTING is saved link evidence; FACT attribution also requires matching original CSV records. No channel allocation or new financial aggregates.",
      "UTM does not change a static LP affiliate measurement ID. Organic search has null UTMs.",
      "Saved HTML and manual evidence are not a live redirect or GA4 remeasurement. External/unregistered activity is outside supplied coverage.",
      "Synthetic fixtures test software; they are not real nonzero Rakuten earnings or market validation."] };
}
const safe = (v) => String(v ?? "UNKNOWN").replace(/[\r\n|]/g, " ").replace(/[<>&]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch]);
export function renderMarkdown(r) {
  const lines = ["# Acquisition Planner v1 — private", "", `Run: ${safe(r.runId)} / asOf: ${r.asOf}`, `Plan status: ${r.planStatus} / plans: ${r.plans.length}`,
    "All action permissions: false. No experiment registration or reservation.", "", "## Reasons", ...r.blockingReasons.map((x) => `- ${x.status}: ${safe(x.code)}`)];
  for (const p of r.plans) lines.push("", `## ${safe(p.experimentId)} / ${safe(p.channel)}`, `- Status: ${p.planStatus}`, `- targetLP: ${safe(p.targetLP)}`,
    `- affiliateClickMeasurementStatus: ${p.affiliateClickMeasurementStatus}`, `- affiliateMeasurementIdStatus: ${p.affiliateMeasurementIdStatus}`,
    `- UTM: ${safe(JSON.stringify(Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content"].map((k) => [k, p[k]]))))}`,
    `- Plan URL: ${safe(p.plannedAcquisitionURL)}`, `- Variables: ${safe(JSON.stringify({ fixed: p.fixedVariables, changed: p.changedVariable }))}`,
    `- Measurement: ${safe(JSON.stringify(p.measurementVerification))}`, `- Binding: ${safe(JSON.stringify(p.measurementIdBinding))}`,
    `- Attribution: ${p.attributionEvidenceType}; ${safe(p.attributionEvidenceStatus)}`, `- Observations: ${safe(JSON.stringify(p.observedRevenueEvidence))}`,
    `- Checklists: ${safe(JSON.stringify({ publish: p.publishChecklist, measurement: p.measurementChecklist }))}`, `- Evidence: ${safe(JSON.stringify(p.evidenceRefs))}`,
    `- Unknowns: ${safe(JSON.stringify(p.unknowns))}`);
  lines.push("", "## Limitations", ...r.limitations.map((l) => `- ${l}`)); return lines.join("\n") + "\n";
}
export function validateOutputRoot(root) {
  const path = resolve(root), rel = relative(resolve(tmpdir()), path);
  assert(path === resolve(DEFAULT_ROOT) || rel && !rel.startsWith("..") && !isAbsolute(rel), "Output must be private Planner root or dedicated OS temp directory"); return path;
}
export async function writeRun(root, report) {
  root = validateOutputRoot(root); await ensurePrivateDirectory(root); assert(identifier(report.runId), "Invalid run ID");
  const staging = join(root, `.pending-${randomUUID()}`), dest = join(root, report.runId); await mkdir(staging, { mode: 0o700 });
  try {
    const metadata = { schemaVersion: 1, runId: report.runId, asOf: report.asOf, generatedAt: report.generatedAt, codeCommit: report.codeCommit,
      inputHashes: report.inputHashes, policyHash: report.policyHash, planStatus: report.planStatus, planIds: report.plans.map((p) => p.planId), ...OPERATIONS };
    for (const [name, value] of Object.entries({ "plan.json": report, "report.md": renderMarkdown(report), "run-metadata.json": metadata }))
      await writeFile(join(staging, name), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await mkdir(dest, { mode: 0o700 });
    try { await rename(staging, dest); } catch (error) { await rm(dest, { recursive: true, force: true }); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}
