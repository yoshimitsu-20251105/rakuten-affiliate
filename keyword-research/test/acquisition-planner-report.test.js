import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { writeRun, renderMarkdown, validateOutputRoot } from "../../acquisition-planner/report.js";
import { OPERATIONS, hash } from "../../acquisition-planner/model.js";
import { setup, run, temporary, writeInputs, AS_OF, fixture } from "./acquisition-planner-helpers.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
test("Private run persists immutable complete plan and metadata with private modes", async (t) => {
  const temp = await temporary(t), r = run(await setup()); await writeRun(temp.root, r);
  assert.deepEqual((await readdir(join(temp.root, r.runId))).sort(), ["plan.json", "report.md", "run-metadata.json"]);
  assert.deepEqual(JSON.parse(await readFile(join(temp.root, r.runId, "plan.json"))), r);
  assert.equal((await stat(join(temp.root, r.runId))).mode & 0o777, 0o700); assert.equal((await stat(join(temp.root, r.runId, "plan.json"))).mode & 0o777, 0o600);
  await assert.rejects(writeRun(temp.root, r)); assert.deepEqual(JSON.parse(await readFile(join(temp.root, r.runId, "plan.json"))), r);
});
test("Root restrictions, symlinks and duplicate run ID cannot overwrite protected files", async (t) => {
  const temp = await temporary(t); assert.throws(() => validateOutputRoot(repo)); assert.throws(() => validateOutputRoot(join(repo, "docs")));
  await symlink(temp.root, join(temp.root, "alias")); await assert.rejects(writeRun(join(temp.root, "alias"), run(await setup())));
});
test("READY includes all seven false flags; notes carry no fabricated publication or engagement", async () => {
  const r = run(await setup({ channel: "note" })), keys = (await fixture("cases")).falseFlags;
  for (const row of [r, r.plans[0], r.plans[0].affiliateNotePostPlan]) for (const k of keys) assert.equal(row[k], false);
  for (const k of ["publishedAt", "postUrl", "impressions", "views", "likes", "outboundLPClicks"]) assert.equal(r.plans[0].affiliateNotePostPlan[k], null);
});
test("Run metadata changes do not change deterministic plan and generated planned URL", async () => {
  const b = await setup(), one = run(b), two = run(b, { runId: "another-save", generatedAt: "2026-10-23T00:00:00Z" });
  assert.deepEqual(one.plans, two.plans); assert.notEqual(one.generatedAt, two.generatedAt);
});
test("Report preserves evidence hashes, all required output fields and outstanding manual execution", async () => {
  const r = run(await setup()), p = r.plans[0];
  for (const k of ["experimentId", "candidateId", "channel", "targetLP", "affiliateClickMeasurementStatus", "utm_source", "utm_medium", "utm_campaign", "utm_content", "affiliateMeasurementId", "contentPurpose", "contentPattern", "ctaPattern", "fixedVariables", "changedVariable", "publishChecklist", "measurementChecklist", "evidenceRefs", "unknowns", "blockingReasons"]) assert(Object.hasOwn(p, k), k);
  assert(p.evidenceRefs.every((e) => /^[a-f0-9]{64}$/.test(e.sourceFileHash))); assert(p.publishChecklist.some((c) => c.status === "PENDING_EXECUTION"));
});
test("Markdown escapes input-controlled text and keeps null outcomes visible", async () => {
  const r = run(await setup()); r.plans[0].experimentId = "<script>bad</script>"; const md = renderMarkdown(r);
  assert(!md.includes("<script>")); assert(md.includes("&lt;script&gt;")); assert(md.includes("null"));
});
test("CLI executes only planning and leaves all explicit input files byte-identical", async (t) => {
  const temp = await temporary(t), b = await setup({ channel: "note" }), manifest = await writeInputs(temp, b);
  const files = (await readdir(temp.root)).map((f) => join(temp.root, f)), before = await Promise.all(files.map((f) => readFile(f)));
  const child = spawnSync(process.execPath, ["acquisition-planner/cli.js", "--manifest", manifest, "--as-of", AS_OF, "--private-dir", join(temp.root, "out")], { cwd: repo, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).planStatus, "READY");
  for (const[i,f]of files.entries()) assert.equal(hash(await readFile(f)), hash(before[i]));
});
test("CLI rejects action/bypass options, implicit current asOf and sensitive failures", () => {
  for (const args of [["--post", "true"], ["--publish", "true"], ["--start", "true"], ["--allow-unverified", "true"], ["--manifest", "DO_NOT_PRINT_SECRET"], ["--manifest", "DO_NOT_PRINT_SECRET", "--as-of", AS_OF]]) {
    const child = spawnSync(process.execPath, ["acquisition-planner/cli.js", ...args], { cwd: repo, encoding: "utf8" }); assert.equal(child.status, 1); assert.equal(child.stdout, ""); assert(!child.stderr.includes("DO_NOT_PRINT_SECRET"));
  }
});
test("Planner module calls contain no API, publication, generation, ledger mutation or git writes", async () => {
  const dir = join(repo, "acquisition-planner");
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".js"))) {
    const code = await readFile(join(dir, name), "utf8"); assert(!/\bfetch\s*\(|https?\.request\s*\(|generate-site|generate-social-posts|select-products|workflow run|git push|git commit|transact\(/.test(code), name);
    if (code.includes("child_process")) { assert.equal(name, "cli.js"); assert(code.includes('["rev-parse", "HEAD"]')); }
  }
});
test("Approved existing assets, code, package, tests and 408 articles match implementation base", async () => {
  const base = "7d0f60d84ac7e4f0890d1b962d805323dd14873c", git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const files = git(["ls-tree", "-r", "--name-only", base]).trim().split("\n");
  assert.equal(git(["diff", "--name-only", base, "--", ...files]), "");
  assert.equal((await readdir(join(repo, "docs/articles"))).filter((f) => f.endsWith(".html")).length, 408);
});
test("Blocked zero-recommendation output also keeps every operation false", async () => {
  const r = run(await setup({ noRecommendation: true })); assert.deepEqual(r.plans, []);
  for (const k of Object.keys(OPERATIONS)) assert.equal(r[k], false); assert.equal(r.planStatus, "BLOCKED");
});
