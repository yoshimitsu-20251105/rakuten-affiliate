#!/usr/bin/env node
import { readFile, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { measurementPeriod, measurementSummary } from "../daily-measurement.js";

try {
  const config = JSON.parse(await readFile(new URL("../search-trial-pages.json", import.meta.url), "utf8"));
  const { from, to } = measurementPeriod(config.pages);
  const runId = `daily-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  if (!/^daily-\d+-\d+$/.test(runId)) throw new Error("GitHub run identity required");
  const result = spawnSync(process.execPath, ["keyword-research/cli/search-trial-report.js", "--from", from, "--to", to, "--run-id", runId, "--live"], { stdio: "inherit", env: process.env });
  if (result.error || result.status !== 0) throw new Error("Daily live measurement did not complete");
  const report = JSON.parse(await readFile(`keyword-research/output/search-trial-reports/${runId}/report.json`, "utf8"));
  const summary = measurementSummary(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary.markdown + "\n");
  console.log(summary.markdown);
  if (summary.notIndexed) console.log("::warning::Some target URLs have no confirmed indexing. Inspect report before changing content.");
  if (summary.unavailable) throw new Error("Measurement incomplete; missing metrics must not be treated as zero");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
