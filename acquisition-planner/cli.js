#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { assert } from "./model.js";
import { readInputs } from "./sources.js";
import { buildReport, writeRun, validateOutputRoot, DEFAULT_ROOT } from "./report.js";

async function main() {
  const args = {}, allowed = ["manifest", "as-of", "run-id", "private-dir"];
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert(process.argv[i].startsWith("--") && allowed.includes(name) && value && !value.startsWith("--") && !Object.hasOwn(args, name), "Invalid or duplicate CLI option"); args[name] = value;
  }
  assert(args.manifest && args["as-of"], "Explicit manifest and as-of required");
  const root = validateOutputRoot(args["private-dir"] ? resolve(args["private-dir"]) : DEFAULT_ROOT), input = await readInputs(resolve(args.manifest), args["as-of"]);
  const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const report = buildReport(input, { runId: args["run-id"], generatedAt: new Date().toISOString(), codeCommit }); await writeRun(root, report);
  console.log(JSON.stringify({ runId: report.runId, planStatus: report.planStatus, planCount: report.plans.length, canStartExperiment: false, canPublish: false, canPost: false }));
}
main().catch(() => { console.error("[planner] Input/output, hash, policy or provenance validation failed; private details omitted"); process.exitCode = 1; });
