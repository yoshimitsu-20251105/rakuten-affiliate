#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assert, hash } from "./model.js";
import { decodeJson, readManifestSources, buildImport } from "./sources.js";
import { buildReview } from "./learning.js";
import { readLedger, transact, DEFAULT_ROOT, validateRoot } from "./store.js";
import { buildReport, writeRun } from "./report.js";

async function main() {
  const command = process.argv[2], args = {};
  const options = { import: ["manifest", "private-dir"], record: ["review", "private-dir"],
    review: ["proposal", "run-id", "as-of", "private-dir", "synthetic"], report: ["run-id", "as-of", "private-dir", "synthetic"] };
  assert(Object.hasOwn(options, command), "Expected import/record/review/report");
  for (let i = 3; i < process.argv.length; i++) {
    const flag = process.argv[i], key = flag.slice(2);
    assert(flag.startsWith("--") && options[command].includes(key) && !Object.hasOwn(args, key), "Invalid or duplicate CLI argument");
    if (key === "synthetic") args[key] = true;
    else { const value = process.argv[++i]; assert(value && !value.startsWith("--"), "CLI value missing"); args[key] = value; }
  }
  const root = validateRoot(args["private-dir"] ? resolve(args["private-dir"]) : DEFAULT_ROOT);
  const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (command === "import") {
    assert(args.manifest, "--manifest required"); const path = resolve(args.manifest), m = decodeJson(await readFile(path));
    const sources = await readManifestSources(m, dirname(path));
    const result = await transact(root, m.purpose, () => buildImport(m, sources, { codeCommit }));
    console.log(JSON.stringify({ status: result.status, addedRecords: result.added, recordCountsAreNotBusinessKpis: true })); return;
  }
  if (command === "record") {
    assert(args.review, "--review required"); const bytes = await readFile(resolve(args.review)), review = decodeJson(bytes);
    const result = await transact(root, review.purpose, (ledger) => buildReview(ledger, review, { sourceFileHash: hash(bytes) }));
    console.log(JSON.stringify({ status: result.status, addedRecords: result.added, recordCountsAreNotBusinessKpis: true })); return;
  }
  const ledger = await readLedger(root);
  let proposal = null, proposalHash = null, measurementContext = null;
  if (command === "review") {
    assert(args.proposal, "--proposal required"); const path = resolve(args.proposal), bytes = await readFile(path);
    proposal = decodeJson(bytes); proposalHash = hash(bytes);
    if (proposal.measurement) measurementContext = { currentPageHash: hash(await readFile(resolve(dirname(path), proposal.measurement.htmlPath))) };
  }
  const report = buildReport(ledger, { codeCommit, proposal, proposalHash, measurementContext, isSynthetic: args.synthetic ?? false,
    ...(args["as-of"] ? { asOf: args["as-of"] } : {}), ...(args["run-id"] ? { runId: args["run-id"] } : {}) });
  await writeRun(root, report);
  console.log(JSON.stringify({ status: report.status, runId: report.runId, outputType: report.outputType, canStartExperiment: false }));
}
main().catch(() => { console.error("[learning] Input/output or contract validation failed; private input details omitted; no experiment actions performed"); process.exitCode = 1; });
