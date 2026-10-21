import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { scanManifest, writeRun, renderMarkdown } from "../../market-scanner/report.js";
import { setup, source, AS_OF } from "./market-scanner-helpers.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(REPO, "market-scanner/cli.js");

test("same inputs/policy/asOf reproduce IDs and evidence; parsedAt is not a material change", async (t) => {
  const { write, options } = await setup(t);
  await write("q.csv", "keyword,monthlySearches\n猫 フード,10\n");
  const m = { schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv")] };
  const first = await scanManifest(m, options);
  const second = await scanManifest(m, { ...options, runId: "second", generatedAt: "2026-10-22T00:00:00Z", previous: first });
  assert.equal(first.candidates[0].candidateId, second.candidates[0].candidateId);
  assert.deepEqual(first.candidates[0].evidenceRefs, second.candidates[0].evidenceRefs);
  assert.equal(second.diff.changes[0].state, "UNCHANGED");
});

test("diff distinguishes new/updated/missing evidence without declaring KILL", async (t) => {
  const { write, options } = await setup(t);
  await write("q.csv", "keyword,monthlySearches\n猫 フード,10\n犬 フード,20\n");
  const m = { schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv")] };
  const first = await scanManifest(m, options);
  await write("q.csv", "keyword,monthlySearches\n猫 フード,30\nシニア 猫 フード,40\n");
  const second = await scanManifest(m, { ...options, runId: "second", previous: first });
  assert.deepEqual(second.diff.changes.map((c) => c.state).sort(), ["NEW", "NOT_OBSERVED_THIS_RUN", "UPDATED"]);
  assert.equal(second.diff.changes.find((c) => c.state === "NOT_OBSERVED_THIS_RUN").reason, "NOT_A_KILL_OR_MARKET_DISAPPEARANCE");
});

test("private JSON/Markdown/metadata are complete, exclusive and cannot overwrite a run", async (t) => {
  const { root, write, options } = await setup(t);
  await write("q.csv", "keyword\n猫 フード\n");
  const report = await scanManifest({ schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv")] }, options);
  const out = join(root, "private");
  await writeRun(out, report);
  assert.deepEqual((await readdir(join(out, report.runId))).sort(), ["candidates.json", "report.md", "run-metadata.json"]);
  const before = await readFile(join(out, report.runId, "candidates.json"));
  await assert.rejects(writeRun(out, report), /EEXIST/);
  assert.deepEqual(await readFile(join(out, report.runId, "candidates.json")), before);
  const md = renderMarkdown(report);
  assert.match(md, /安定ID順/); assert.match(md, /revenue: UNKNOWN/);
  assert.equal((await readdir(out)).filter((p) => p.startsWith(".pending-")).length, 0);
  const metadata = JSON.parse(await readFile(join(out, report.runId, "run-metadata.json"), "utf8"));
  assert.equal(metadata.candidateCountIsNotBusinessKpi, true);
});

test("CLI executes offline, preserves protected assets and supports previous-run; bad input leaves no report", async (t) => {
  const { root, write } = await setup(t);
  await write("q.csv", "keyword,impressions\n猫 フード,0\n");
  const manifest = { schemaVersion: 1, sources: [source("q", "manual_csv", "q.csv")] };
  const manifestPath = await write("manifest.json", manifest);
  const guard = await write("network-guard.mjs", 'import http from "node:http"; import https from "node:https"; const fail=()=>{throw new Error("UNEXPECTED_NETWORK")}; globalThis.fetch=fail; http.request=fail; http.get=fail; https.request=fail; https.get=fail;\n');
  const privateDir = join(root, "private");
  const run = (...args) => spawnSync(process.execPath, ["--import", guard, CLI, "--manifest", manifestPath, "--as-of", AS_OF, "--private-dir", privateDir, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, RAKUTEN_APP_ID: "synthetic-do-not-use", GA_SEARCH_CONSOLE_KEY_FILE: "synthetic-do-not-use" } });
  let result = run("--run-id", "first"); assert.equal(result.status, 0, result.stderr);
  const first = JSON.parse(await readFile(join(privateDir, "first/candidates.json"), "utf8"));
  assert.equal(first.candidates.length, 1);
  result = run("--run-id", "second", "--previous-run", "first"); assert.equal(result.status, 0, result.stderr);
  const second = JSON.parse(await readFile(join(privateDir, "second/candidates.json"), "utf8"));
  assert.equal(second.diff.changes[0].state, "UNCHANGED");
  assert.notEqual(run("--run-id", "second").status, 0);
  await writeFile(manifestPath, JSON.stringify({ ...manifest, sources: [{ ...manifest.sources[0], path: "missing-private-name.csv" }] }));
  result = run("--run-id", "bad"); assert.notEqual(result.status, 0);
  assert(!result.stderr.includes("missing-private-name.csv"));
  await assert.rejects(readFile(join(privateDir, "bad/candidates.json")), /ENOENT/);
  const protectedPaths = ["docs", "funnel-measurement", ".github/workflows", "strategy", "select-products.js", "generate-site.js", "articles-data.json", "selected-products.json", "posted-history.json", "sitemap-lastmod.json", "package-lock.json"];
  execFileSync("git", ["diff", "--exit-code", "HEAD", "--", ...protectedPaths], { cwd: REPO });
});

test("explicit invalid source and traversal/unknown CLI flags never produce public output", async (t) => {
  const { root, write } = await setup(t);
  const path = await write("manifest.json", { schemaVersion: 1, sources: [] });
  const run = (...args) => spawnSync(process.execPath, [CLI, "--manifest", path, ...args], { encoding: "utf8" });
  assert.notEqual(run("--private-dir", join(REPO, "docs")).status, 0);
  assert.notEqual(run("--private-dir", join(root, "private"), "--previous-run", "../escape").status, 0);
  assert.notEqual(run("--use-rakuten", "true").status, 0);
});
