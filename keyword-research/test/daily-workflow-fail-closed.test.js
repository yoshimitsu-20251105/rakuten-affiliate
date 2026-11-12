import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BASE_COMMIT, WORKFLOW_PATH, GUARD_PATH, WORKFLOW_SHA256, APPROVED_GUARD_SHA256, sha256,
  validateDailyWorkflow, isApprovedDailyAuditChange, isApprovedDailyGuardChange } from "../../daily-audit/policy.js";
import { evaluateSavedState, readSavedState, renderSummary, appendActionsSummary, NO_ACTIONS } from "../../daily-audit/report.js";
import * as shared from "./experiment-review-protection-helpers.js";
import * as safety from "./protected-assets-helpers.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const workflowText = await readFile(join(repo, WORKFLOW_PATH), "utf8"), workflow = JSON.parse(workflowText);
const registryBytes = await readFile(join(repo, "strategy/experiments.json"));
const summaryBytes = await readFile(join(repo, "strategy/experiment-reviews/2026-11-09/reselection-summary.json"));
const noActions = state => { for (const key of Object.keys(NO_ACTIONS)) assert.equal(state[key], false, key); };

test("Schedule and manual events share one audit-only job with read permissions and no credential persistence", () => {
  validateDailyWorkflow(workflowText);
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read", pages: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["audit"]);
  assert(!Object.hasOwn(workflow.jobs.audit, "if"));
  const steps = workflow.jobs.audit.steps;
  assert.equal(steps.length, 6);
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.equal(steps[0].with["fetch-depth"], 0);
  assert.deepEqual(steps.filter(s => s.uses).map(s => s.uses), ["actions/checkout@v4", "actions/setup-node@v4"]);
  for (const step of steps) assert(!step.env && !step.permissions);
  const commands = steps.filter(s => s.run).map(s => s.run);
  assert.equal(commands.length, 4);
  assert(commands.includes("npm run strategy:validate"));
  assert(commands.includes("node check-links.js"));
  assert(commands.includes("node daily-audit/cli.js --checks-status ${{ job.status }}"));
  assert(commands.some(c => c.startsWith("node --test ") && c.includes("publishing-safety-cli.test.js") && c.includes("experiment-review-closure.test.js") && c.includes("daily-workflow-fail-closed.test.js")));
  // No conditional publisher can become reachable for schedule, zero selections,
  // BLOCKED, READY, workflow_dispatch or a forged environment enable switch.
  assert(!/git\s+(add|commit|push)|select-products\.js|generate-site\.js|generate-social-posts\.js|action-send-mail|deploy-pages|workflow run|secrets\.|browser|playwright|curl\s|wget\s/.test(workflowText));
  const scripts = JSON.parse(git("show", `${BASE_COMMIT}:package.json`)).scripts;
  assert.equal(scripts["strategy:validate"], "node strategy/cli/validate.js");
});

for (const [name, change] of [
  ["contents write", w => w.permissions.contents = "write"],
  ["hidden publisher job", w => w.jobs.publish = { "runs-on": "ubuntu-latest", steps: [{ run: "git push" }] }],
  ["commit step", w => w.jobs.audit.steps.push({ run: "git add -A && git commit -m bad && git push" })],
  ["generator step", w => w.jobs.audit.steps.push({ run: "node generate-site.js" })],
  ["mail action", w => w.jobs.audit.steps.push({ uses: "dawidd6/action-send-mail@v3" })],
  ["secret injection", w => w.jobs.audit.steps[2].env = { TOKEN: "${{ secrets.GITHUB_TOKEN }}" }],
  ["alternate event", w => w.on.push = {}],
]) test(`Workflow protection rejects ${name}`, () => {
  const bad = structuredClone(workflow); change(bad);
  assert.throws(() => validateDailyWorkflow(JSON.stringify(bad, null, 2) + "\n"));
});

test("Current saved zero recommendations and BLOCKED are a safe hold, never publication success", () => {
  const state = evaluateSavedState(registryBytes, summaryBytes);
  assert.equal(state.status, "HELD_NO_SELECTOR_RECOMMENDATION");
  assert.equal(state.selectorRecommendationCount, 0); assert.equal(state.plannerStatus, "BLOCKED");
  assert(state.plannerReasons.includes("NO_SELECTOR_RECOMMENDATION"));
  assert.equal(state.runningCount, 0); assert.equal(state.savedMonetizationCount, 0); assert.equal(state.monetizationLimit, 1);
  noActions(state);
  const text = renderSummary(state, { checksStatus: "success", clean: true });
  assert(text.includes("安全に公開を見送り")); assert(!text.includes("公開成功"));
});

for (const [name, count, status, plans] of [["zero/BLOCKED", 0, "BLOCKED", 0], ["one/BLOCKED", 1, "BLOCKED", 0], ["one/READY", 1, "READY", 1]])
  test(`${name} has no generation, commit, push, publication, notification or browser capability`, () => {
    const saved = JSON.parse(summaryBytes); saved.selector.recommendationCount = count; saved.planner.status = status; saved.planner.plans = plans;
    const state = evaluateSavedState(registryBytes, Buffer.from(JSON.stringify(saved)));
    assert.notEqual(state.status, "UNKNOWN"); noActions(state);
  });

for (const [name, mutate] of [
  ["missing selection count", s => delete s.selector.recommendationCount],
  ["stale registry hash", s => s.registryRawHash = "0".repeat(64)],
  ["zero with READY", s => { s.planner.status = "READY"; s.planner.plans = 1; }],
  ["injected reason", s => s.planner.reasons = [{ code: "<script>unsafe</script>" }]],
]) test(`Missing or inconsistent saved state fails closed: ${name}`, () => {
  const saved = JSON.parse(summaryBytes); mutate(saved);
  const state = evaluateSavedState(registryBytes, Buffer.from(JSON.stringify(saved)));
  assert.equal(state.status, "UNKNOWN"); assert.equal(state.selectorRecommendationCount, null); noActions(state);
});

test("Unreadable reports stay UNKNOWN and prior failed checks cannot be described as a completed audit", async () => {
  const state = await readSavedState(join(tmpdir(), "nonexistent-daily-audit-inputs"));
  assert.equal(state.status, "UNKNOWN"); assert.equal(state.selectorRecommendationCount, null); noActions(state);
  const text = renderSummary(evaluateSavedState(registryBytes, summaryBytes), { checksStatus: "failure", clean: true });
  assert(text.includes("検証: FAIL")); assert(!text.includes("検証完了。"));
});

test("Safety and daily audit retain the shared closure-aware guard functions", () => {
  for (const name of ["permittedGeneratedUpdate", "captureProtectedTree", "assertProtectedTreeUnchanged", "assertHistoricalProtection"])
    assert.equal(safety[name], shared[name]);
  const old = '<a href="https://example.test/affiliate">CTA</a>';
  assert(!shared.permittedGeneratedUpdate("docs/articles/item.html", old, old.replace("CTA", "new")));
  assert(!shared.permittedGeneratedUpdate("docs/rankings/item.html", old, old.replace("affiliate", "different")));
});

test("Only the exact authorized workflow and sealed guard differ from the new master; all other baseline files retain their Git blob hashes", async () => {
  const entries = execFileSync("git", ["ls-tree", "-rz", BASE_COMMIT], { cwd: repo }).toString().split("\0").filter(Boolean);
  const baselinePaths = [];
  for (const entry of entries) {
    const tab = entry.indexOf("\t"), path = entry.slice(tab + 1), expected = entry.slice(0, tab).split(" ")[2];
    baselinePaths.push(path); const bytes = await readFile(join(repo, path));
    if (path === WORKFLOW_PATH) {
      assert(isApprovedDailyAuditChange(execFileSync("git", ["show", `${BASE_COMMIT}:${path}`], { cwd: repo }), bytes.toString()));
      assert.equal(sha256(bytes), WORKFLOW_SHA256);
    } else if (path === GUARD_PATH) assert.equal(sha256(bytes), APPROVED_GUARD_SHA256);
    else assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), expected, path);
  }
  const currentPaths = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  for (const prefix of ["docs/", ".github/"]) assert.deepEqual(currentPaths.filter(p => p.startsWith(prefix)).sort(), baselinePaths.filter(p => p.startsWith(prefix)).sort());
  assert.equal(baselinePaths.filter(p => p.startsWith("docs/articles/") && p.endsWith(".html")).length, 408);
});

test("The two file-specific authorizations reject tampered old/new workflow or guard bytes", async () => {
  const oldWorkflow = git("show", `${BASE_COMMIT}:${WORKFLOW_PATH}`), oldGuard = git("show", `${BASE_COMMIT}:${GUARD_PATH}`), currentGuard = await readFile(join(repo, GUARD_PATH), "utf8");
  assert(isApprovedDailyAuditChange(oldWorkflow, workflowText));
  assert(!isApprovedDailyAuditChange(oldWorkflow + "\n", workflowText));
  assert(!isApprovedDailyAuditChange(oldWorkflow, workflowText + "\ngit push\n"));
  assert(isApprovedDailyGuardChange(oldGuard, currentGuard));
  assert(!isApprovedDailyGuardChange(oldGuard, currentGuard + "\n"));
});

test("Actions Summary is written only outside the repository; protected files and symlinks are rejected", async t => {
  const temp = await mkdtemp(join(tmpdir(), "daily-audit-summary-")); t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "summary.md"); await writeFile(path, "");
  const text = renderSummary(evaluateSavedState(registryBytes, summaryBytes), { checksStatus: "success", clean: true });
  await appendActionsSummary(path, text, repo); assert.equal(await readFile(path, "utf8"), text);
  await symlink(path, join(temp, "alias")); await assert.rejects(appendActionsSummary(join(temp, "alias"), "bad", repo));
  const before = await readFile(join(repo, "strategy/experiments.json"));
  await assert.rejects(appendActionsSummary(join(repo, "strategy/experiments.json"), "bad", repo));
  assert.deepEqual(await readFile(join(repo, "strategy/experiments.json")), before);
});

test("Scheduled CLI reports a hold only on a clean tree, fails closed on pending changes, and preserves every byte and Git status", () => {
  const status = git("status", "--porcelain=v1", "--untracked-files=all"), clean = status === "";
  const before = shared.captureProtectedTree(repo);
  const child = spawnSync(process.execPath, ["daily-audit/cli.js", "--checks-status", "success"], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: "schedule", AUTO_PUBLISH: "true" } });
  assert.equal(child.status, clean ? 0 : 1, child.stderr);
  assert(child.stdout.includes(clean ? "安全に公開を見送り" : "検証未完了")); assert(child.stdout.includes("AUTO_PUBLISH: false"));
  assert.equal(git("status", "--porcelain=v1", "--untracked-files=all"), status); shared.assertProtectedTreeUnchanged(before, shared.captureProtectedTree(repo));
});

test("CLI rejects publication/bypass options and failed validation exits nonzero without granting any action", () => {
  for (const args of [["--publish", "true"], ["--post", "true"], ["--notify", "true"], ["--auto-publish", "true"]]) {
    const child = spawnSync(process.execPath, ["daily-audit/cli.js", ...args], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(child.status, 1); assert.equal(child.stdout, "");
  }
  const child = spawnSync(process.execPath, ["daily-audit/cli.js", "--checks-status", "failure"], { cwd: repo, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(child.status, 1); assert(child.stdout.includes("検証: FAIL")); assert(!child.stdout.includes("公開成功"));
});
