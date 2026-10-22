#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assert } from "./model.js";
import { readInputs } from "./sources.js";
import { buildReport, writeRun, validateOutputRoot, DEFAULT_ROOT } from "./report.js";

async function main() {
  const args = {}, allowed = ["manifest", "as-of", "run-id", "private-dir"];
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i].slice(2), value = process.argv[i + 1];
    assert(process.argv[i].startsWith("--") && allowed.includes(name) && value && !value.startsWith("--") && !Object.hasOwn(args, name), "Invalid or duplicate CLI option"); args[name] = value;
  }
  assert(args.manifest, "--manifest is required");
  const root = validateOutputRoot(args["private-dir"] ? resolve(args["private-dir"]) : DEFAULT_ROOT);
  const input = await readInputs(resolve(args.manifest), args["as-of"] ?? new Date().toISOString());
  const codeCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const report = buildReport(input, { runId: args["run-id"] ?? randomUUID(), codeCommit }); await writeRun(root, report);
  console.log(JSON.stringify({ runId: report.runId, status: report.status, recommendationCount: report.recommendationCount, canStartExperiment: false }));
}
main().catch(() => { console.error("[selector] Input/output, hash, policy or reference validation failed; private details omitted"); process.exitCode = 1; });
