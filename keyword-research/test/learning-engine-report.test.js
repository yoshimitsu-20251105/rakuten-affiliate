import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, symlink, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { buildReport, renderMarkdown, writeRun } from "../../learning-engine/report.js";
import { transact } from "../../learning-engine/store.js";
import { hash } from "../../learning-engine/model.js";
import { base, reviewed, temporary, AS_OF, spec, experiment, input, IMPORTED_AT } from "./learning-engine-helpers.js";

const repo = fileURLToPath(new URL("../../", import.meta.url)), cli = join(repo, "learning-engine/cli.js");
const command = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8" });
test("report keeps result/decision/learning/falsification separate and null Revenue visible", async () => {
  const b = await reviewed(), before = hash(b.ledger);
  const r = buildReport(b.ledger, { asOf: AS_OF, generatedAt: AS_OF, runId: "test-report", isSynthetic: true, proposal: b.proposal });
  assert.equal(r.experimentReviews[0].result, "FAILED"); assert.equal(r.experimentReviews[0].sourceDecision, "IMPROVE");
  assert.equal(r.experimentReviews[0].observedPerformance.metrics.revenue.value, null);
  assert.equal(r.learningIndex[0].active.falsification.status, "INCONCLUSIVE"); assert.equal(r.learningIndex[0].active.claim.evidenceType, "HYPOTHESIS");
  assert.equal(r.canStartExperiment, false); assert.equal(hash(b.ledger), before);
  const md = renderMarkdown(r); assert.match(md, /revenue: UNKNOWN/); assert.match(md, /SATISFIED/); assert.match(md, /Recorded decisions \(no actions\)/);
  assert.match(md, /synthetic: true/); assert.equal(r.decisionIndex.length, 5);
});
test("run output is private, immutable and excludes source paths", async (t) => {
  const temp = await temporary(t), b = base(), r = buildReport(b.ledger, { asOf: AS_OF, generatedAt: AS_OF, runId: "private", isSynthetic: true });
  await writeRun(temp.root, r); const dir = join(temp.root, "runs/private");
  assert.deepEqual((await readdir(dir)).sort(), ["report.md", "review.json", "run-metadata.json"]);
  assert.equal((await lstat(join(dir, "review.json"))).mode & 0o777, 0o600); assert.equal((await lstat(dir)).mode & 0o777, 0o700);
  const before = await readFile(join(dir, "review.json"), "utf8"); await assert.rejects(writeRun(temp.root, r));
  assert.equal(await readFile(join(dir, "review.json"), "utf8"), before); assert.equal(before.includes(temp.root), false);
});
test("run directory symlinks and unsafe run IDs fail closed", async (t) => {
  const temp = await temporary(t), other = await temporary(t), r = buildReport(base().ledger, { asOf: AS_OF, generatedAt: AS_OF });
  await symlink(other.root, join(temp.root, "runs")); await assert.rejects(writeRun(temp.root, r));
  assert.throws(() => buildReport(base().ledger, { runId: "../docs" }));
});
test("known-at report excludes later records and reports conflicting source snapshots without overwriting", () => {
  const b = base(); const later = input([[spec("experiments"), { items: [experiment({ result: "INCONCLUSIVE", status: "INCONCLUSIVE" })] }]], { recordedAt: AS_OF });
  return transactPure();
  async function transactPure() {
    const { append } = await import("../../learning-engine/store.js");
    const ledger = append(b.ledger, later.additions).ledger;
    const historical = buildReport(ledger, { asOf: IMPORTED_AT, generatedAt: AS_OF, isSynthetic: true });
    assert.equal(historical.experimentReviews[0].result, "FAILED");
    const current = buildReport(ledger, { asOf: AS_OF, generatedAt: AS_OF, isSynthetic: true });
    assert.equal(current.experimentReviews[0].snapshotState, "CONFLICT"); assert.equal(current.experimentReviews[0].result, null);
    assert.equal(ledger.experimentSnapshots.length, 2);
  }
});
test("CLI import / duplicate import / record / report / review perform only explicit private operations", async (t) => {
  const temp = await temporary(t), b = await reviewed();
  const exps = await temp.write("experiments.json", { items: [experiment()] });
  const manifest = await temp.write("manifest.json", { schemaVersion: 1, purpose: "AFFILIATE_MONETIZATION", sources: [{ ...spec("experiments"), path: exps }], links: [] });
  const imported = command(["import", "--manifest", manifest, "--private-dir", temp.root]); assert.equal(imported.status, 0, imported.stderr);
  const repeated = command(["import", "--manifest", manifest, "--private-dir", temp.root]); assert.equal(repeated.status, 0); assert.equal(JSON.parse(repeated.stdout).status, "DUPLICATE");
  const review = await temp.write("manual-review.json", b.review);
  const recorded = command(["record", "--review", review, "--private-dir", temp.root]); assert.equal(recorded.status, 0, recorded.stderr);
  const recordAgain = command(["record", "--review", review, "--private-dir", temp.root]); assert.equal(recordAgain.status, 0, recordAgain.stderr); assert.equal(JSON.parse(recordAgain.stdout).status, "DUPLICATE");
  const ledgerBefore = await readFile(join(temp.root, "ledger.json"));
  const report = command(["report", "--run-id", "cli-report", "--synthetic", "--private-dir", temp.root]); assert.equal(report.status, 0, report.stderr);
  const proposal = await temp.write("proposal.json", { ...b.proposal, newEvidenceRefs: [] });
  const proposed = command(["review", "--proposal", proposal, "--run-id", "cli-proposal", "--synthetic", "--private-dir", temp.root]); assert.equal(proposed.status, 0, proposed.stderr);
  assert.equal(JSON.parse(proposed.stdout).canStartExperiment, false);
  assert.deepEqual(await readFile(join(temp.root, "ledger.json")), ledgerBefore);
});
test("CLI failures redact raw private input and never fall back to fixtures", async (t) => {
  const temp = await temporary(t), marker = "PRIVATE_MARKER_MUST_NOT_LEAK";
  const bad = await temp.write("bad.json", `{${marker}`);
  const r = command(["import", "--manifest", bad, "--private-dir", temp.root]); assert.notEqual(r.status, 0);
  assert.equal(r.stderr.includes(marker), false); assert.equal(r.stderr.includes(temp.root), false);
  assert.notEqual(command(["report", "--private-dir", temp.root]).status, 0);
  assert.notEqual(command(["report", "--auto-start", "true"]).status, 0);
  assert.notEqual(command(["publish"]).status, 0);
});
test("Markdown escapes source HTML and independent judgments are not actions", async () => {
  const b = await reviewed(); b.ledger.learnings[0].claim.text = "<script>alert(1)</script>";
  const old = b.ledger.learnings[0];
  // Rendering is pure and can also handle untrusted display text from an already validated report.
  const r = buildReport((await reviewed()).ledger, { asOf: AS_OF, generatedAt: AS_OF, isSynthetic: true });
  r.learningIndex[0].leaves[0].claim.text = old.claim.text;
  const md = renderMarkdown(r); assert(!md.includes("<script>")); assert(md.includes("&lt;script&gt;"));
});
test("all protected tracked files match master except four additive package scripts", async () => {
  const baseline = "origin/master";
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline], { cwd: repo, encoding: "utf8" }).trim().split("\n");
  const oldFiles = files.filter((f) => f !== "package.json");
  assert.equal(execFileSync("git", ["diff", "--name-only", baseline, "--", ...oldFiles], { cwd: repo, encoding: "utf8" }), "");
  const original = JSON.parse(execFileSync("git", ["show", `${baseline}:package.json`], { cwd: repo, encoding: "utf8" }));
  const actual = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  for (const key of Object.keys(original.scripts)) assert.equal(actual.scripts[key], original.scripts[key]);
  assert.deepEqual(actual.dependencies, original.dependencies);
  const added = Object.keys(actual.scripts).filter((k) => !Object.hasOwn(original.scripts, k));
  assert.deepEqual(added.sort(), ["learning:import", "learning:record", "learning:report", "learning:review"]);
  assert.equal((await readdir(join(repo, "docs/articles"))).filter((f) => f.endsWith(".html")).length, 408);
});
test("Learning modules do not call API, generation, publication, posting or git writes", async () => {
  const dir = join(repo, "learning-engine");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".js"))) {
    const code = await readFile(join(dir, file), "utf8");
    assert(!/\bfetch\s*\(|https?\.request\s*\(|generate-site|select-products|generate-social-posts|workflow run|git push|git commit/.test(code), file);
    if (code.includes("child_process")) { assert.equal(file, "cli.js"); assert(code.includes('["rev-parse", "HEAD"]')); }
  }
});
