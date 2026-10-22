import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, stat, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { buildReport, writeRun, renderMarkdown, validateOutputRoot } from "../../experiment-selector/report.js";
import { setup, run, temporary, writeInputs, AS_OF } from "./experiment-selector-helpers.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
test("Private report stores immutable run, hashes, definitions, reasons and independent views", async (t) => {
  const temp = await temporary(t), b = await setup(), r = run(b); await writeRun(temp.root, r);
  assert.deepEqual((await readdir(join(temp.root, r.runId))).sort(), ["report.md", "run-metadata.json", "selection.json"]);
  const saved = JSON.parse(await readFile(join(temp.root, r.runId, "selection.json"), "utf8")); assert.deepEqual(saved, r);
  assert.equal((await stat(join(temp.root, r.runId))).mode & 0o777, 0o700);
  assert.equal((await stat(join(temp.root, r.runId, "selection.json"))).mode & 0o777, 0o600);
  await assert.rejects(writeRun(temp.root, r)); assert.deepEqual(JSON.parse(await readFile(join(temp.root, r.runId, "selection.json"))), r);
});
test("Private output cannot be redirected to docs, source or symlinked storage", async (t) => {
  const temp = await temporary(t); assert.throws(() => validateOutputRoot(join(repo, "docs"))); assert.throws(() => validateOutputRoot(repo));
  await symlink(temp.root, join(temp.root, "alias")); await assert.rejects(writeRun(join(temp.root, "alias"), run(await setup())));
});
test("Markdown escapes candidate-controlled text and preserves missing indicators", async () => {
  const r = run(await setup()); r.selectionReason = "<script>bad</script>\n|x"; const md = renderMarkdown(r);
  assert(!md.includes("<script>")); assert(md.includes("&lt;script&gt;")); assert(md.includes("null")); assert(md.includes("HYPOTHESIS"));
});
test("CLI produces private report without changing any of its inputs", async (t) => {
  const temp = await temporary(t), b = await setup(), manifest = await writeInputs(temp, b);
  const paths = Object.keys(b.hashes).map((k) => join(temp.root, `${k}.json`)), before = await Promise.all(paths.map((p) => readFile(p, "utf8")));
  const child = spawnSync(process.execPath, ["experiment-selector/cli.js", "--manifest", manifest, "--as-of", AS_OF, "--run-id", "cli-test", "--private-dir", join(temp.root, "out")], { cwd: repo, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).canStartExperiment, false);
  assert.deepEqual(await Promise.all(paths.map((p) => readFile(p, "utf8"))), before);
});
test("CLI rejects start/publish/post, duplicate options and sensitive failures with no output run", async (t) => {
  const temp = await temporary(t);
  for (const args of [["--start", "true"], ["--publish", "true"], ["--post", "true"], ["--manifest", "secret-token-DO_NOT_PRINT"], ["--as-of", AS_OF, "--as-of", AS_OF]]) {
    const child = spawnSync(process.execPath, ["experiment-selector/cli.js", ...args], { cwd: repo, encoding: "utf8" });
    assert.equal(child.status, 1); assert(!child.stderr.includes("DO_NOT_PRINT")); assert.equal(child.stdout, "");
  }
  assert.deepEqual(await readdir(temp.root), []);
});
test("Selector modules have no network, state transition, publication, posting or git write call", async () => {
  const dir = join(repo, "experiment-selector");
  for (const name of (await readdir(dir)).filter((f) => f.endsWith(".js"))) {
    const code = await readFile(join(dir, name), "utf8");
    assert(!/\bfetch\s*\(|https?\.request\s*\(|generate-site|select-products|generate-social-posts|workflow run|git push|git commit|transact\(/.test(code), name);
    if (code.includes("child_process")) { assert.equal(name, "cli.js"); assert(code.includes('["rev-parse", "HEAD"]')); }
  }
});
test("All preexisting tracked assets remain byte-identical to approved merge base except additive CLI script", async () => {
  const base = "be82af82efa76fa091586d8cd4ff563e680d285f", git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const files = git(["ls-tree", "-r", "--name-only", base]).trim().split("\n");
  assert.equal(git(["diff", "--name-only", base, "--", ...files.filter((f) => f !== "package.json")]), "");
  const before = JSON.parse(git(["show", `${base}:package.json`])), actual = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  assert.equal(actual.scripts["experiment:select"], "node experiment-selector/cli.js"); delete actual.scripts["experiment:select"]; assert.deepEqual(actual, before);
  assert.equal((await readdir(join(repo, "docs/articles"))).filter((f) => f.endsWith(".html")).length, 408);
});
