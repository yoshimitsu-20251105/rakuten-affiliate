import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { zeroBytes, meta, verified, html, targetLP } from "./funnel-helpers.js";

const cli = fileURLToPath(new URL("../../funnel-measurement/cli.js", import.meta.url));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });

test("CLI zero import/re-import/private reports and measurement gate; docs and protected paths unchanged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "funnel-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDir = join(root, "private");
  const csv = join(root, "order.csv"), metadata = join(root, "meta.json"), proof = join(root, "measurement.json"), htmlPath = join(root, "lp.html");
  await writeFile(csv, zeroBytes); await writeFile(metadata, JSON.stringify(meta())); await writeFile(proof, JSON.stringify(verified())); await writeFile(htmlPath, html);
  let result = run("import-order", "--csv", csv, "--metadata", metadata, "--private-dir", privateDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "IMPORTED");
  result = run("import-order", "--csv", csv, "--metadata", metadata, "--private-dir", privateDir);
  assert.equal(JSON.parse(result.stdout).status, "DUPLICATE");
  const reportArgs = ["report", "--account", "synthetic-account", "--month", "2026.10", "--synthetic", "--private-dir", privateDir, "--run-id", "zero-test"];
  result = run(...reportArgs);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(privateDir, "report-runs/zero-test/report.json"), "utf8"));
  assert.equal(report.metrics.revenue.value, 0);
  assert.equal(report.sourceBatch.resultType, "ZERO_RECORD_SNAPSHOT");
  const before = await readFile(join(privateDir, "report-runs/zero-test/report.json"), "utf8");
  assert.notEqual(run(...reportArgs).status, 0);
  assert.equal(await readFile(join(privateDir, "report-runs/zero-test/report.json"), "utf8"), before);
  result = run("validate-measurement", "--measurement-record", proof, "--private-dir", privateDir);
  assert.equal(result.status, 0, result.stderr);
  result = run("check-note-start", "--measurement-record", proof, "--experiment-id", "synthetic-only", "--lp", targetLP, "--html", htmlPath, "--property", "synthetic-property", "--at", "2026-10-20T00:00:00Z");
  assert.equal(result.status, 0, result.stderr);
  await writeFile(proof, JSON.stringify({ targetLP, affiliateClickMeasurementStatus: "NOT_IMPLEMENTED" }));
  assert.notEqual(run("check-note-start", "--measurement-record", proof, "--experiment-id", "synthetic-only", "--lp", targetLP, "--html", htmlPath, "--property", "synthetic-property").status, 0);
  // Byte-level tracked comparison against HEAD; never run production generators.
  const protectedPaths = ["docs", ".github/workflows", "strategy/experiments.json", "select-products.js", "generate-site.js", "articles-data.json", "selected-products.json", "posted-history.json", "sitemap-lastmod.json"];
  execFileSync("git", ["diff", "--exit-code", "HEAD", "--", ...protectedPaths], { cwd: repo });
});

test("bad CSV is rejected without ledger; CLI will not write private output into docs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "funnel-cli-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const csv = join(root, "bad.csv"), metadata = join(root, "meta.json");
  await writeFile(csv, "bad format"); await writeFile(metadata, JSON.stringify(meta()));
  const result = run("import-order", "--csv", csv, "--metadata", metadata, "--private-dir", join(root, "private"));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(join(root, "private/ledger.json")), /ENOENT/);
  assert.notEqual(run("report", "--account", "test", "--month", "2026.10", "--private-dir", join(repo, "docs")).status, 0);
});
