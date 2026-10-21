#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ensurePrivateDirectory } from "../funnel-measurement/store.js";
import { assert, identifier } from "./model.js";
import { readInputs, buildReport, writeRun, DEFAULT_ROOT, validateOutputRoot } from "./report.js";

async function main() {
  const args = {}, allowed = new Set(["scanner-report", "context", "run-id", "as-of", "previous-run", "private-dir"]);
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert(process.argv[i].startsWith("--") && allowed.has(name) && value && !value.startsWith("--") && !Object.hasOwn(args, name), "invalid or duplicate CLI argument");
    args[name] = value;
  }
  assert(args["scanner-report"], "--scanner-report is required");
  const root = validateOutputRoot(args["private-dir"] ? resolve(args["private-dir"]) : DEFAULT_ROOT);
  const inputs = await readInputs(resolve(args["scanner-report"]), args.context ? resolve(args.context) : null);
  let previous = null;
  if (args["previous-run"]) {
    assert(identifier(args["previous-run"]), "invalid previous-run");
    await ensurePrivateDirectory(root);
    previous = JSON.parse(await readFile(join(root, args["previous-run"], "assessments.json"), "utf8"));
  }
  const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const report = buildReport(inputs.scanner, { ...inputs, runId: args["run-id"] ?? randomUUID(), asOf: args["as-of"] ?? new Date().toISOString(), previous, codeCommit });
  await writeRun(root, report);
  console.log(JSON.stringify({ status: report.status, runId: report.runId, assessmentCount: report.assessments.length, outputType: report.outputType }));
}

main().catch((error) => {
  console.error(error.code || error instanceof SyntaxError || error instanceof TypeError ? "[opportunity] Input/output or JSON/type validation failed; private input details omitted" : `[opportunity] ${error.message}`);
  process.exitCode = 1;
});
