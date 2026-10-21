import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildReport } from "../../opportunity-scorer/report.js";

export const AS_OF = "2026-10-21T00:00:00Z";
export const COMPONENT_KEYS = ["value", "maxScore", "evidenceRefs", "evidenceType", "source", "period", "freshness", "reason", "missingReason"];
export async function data({ nonSyntheticSchemaBranch = false, complete = false } = {}) {
  const read = async (name) => JSON.parse(await readFile(new URL(`../fixtures/opportunity-scorer-${name}.synthetic.json`, import.meta.url), "utf8"));
  const scanner = await read("scanner-report"), context = await read("context");
  // Still fabricated test data, never a real report. Exercise the non-synthetic
  // contract branch without labelling the checked-in fixture as live validation.
  const mark = (value) => {
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "isSynthetic")) value.isSynthetic = false;
      Object.values(value).forEach(mark);
    }
  };
  if (nonSyntheticSchemaBranch) { mark(scanner); mark(context); }
  if (complete) for (const row of context.assessments) { row.components.offerFit.value = 24; row.components.offerFit.evidenceType = "HYPOTHESIS"; }
  return { scanner, context };
}
export const run = (d, options = {}) => buildReport(d.scanner, { context: d.context, asOf: AS_OF, generatedAt: AS_OF, runId: "unit-test", ...options });
export const assessmentFor = (r, id) => r.assessments.find((a) => a.candidateId === id);
export function metricParts(d, candidate, key) {
  const raw = candidate.observedRevenueEvidence[key];
  const evidence = d.scanner.evidence.find((e) => e.evidenceId === raw.evidenceRefs[0]);
  const saved = d.scanner.runContext.funnelReports.find((r) => r.sourceId === evidence?.sourceId);
  const original = saved?.report.byMeasurementId.find((e) => e.measurementId === raw.scope?.measurementId)?.metrics[key];
  return { raw, evidence, saved, original };
}
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "opportunity-scorer-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => { const path = join(root, name); await writeFile(path, typeof value === "string" ? value : JSON.stringify(value)); return path; };
  return { root, write };
}
export function hasKey(value, key) {
  return value !== null && typeof value === "object" && (Object.hasOwn(value, key) || Object.values(value).some((v) => hasKey(v, key)));
}
