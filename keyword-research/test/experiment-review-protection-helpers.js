import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { validateReviewClosures } from "./experiment-review-helpers.js";
import { contentHash } from "../../lib/sitemap-lastmod.js";
import { WORKFLOW_PATH, GUARD_PATH, isApprovedDailyAuditChange, isApprovedDailyGuardChange } from "../../daily-audit/policy.js";
import { permittedSeniorCatTrackingUpdate, permittedSeniorCatQaQueryUpdate, permittedNullObservationUpdate } from "./senior-cat-affiliate-measurement-helpers.js";

// Explicitly approved test maintenance, not an exemption for product code.
const approvedTestEdits = new Set([
  "keyword-research/test/acquisition-planner-report.test.js",
  "keyword-research/test/experiment-selector-report.test.js",
  "keyword-research/test/learning-engine-report.test.js",
  "keyword-research/test/experiment-selector-gates.test.js",
  "keyword-research/test/learning-engine-sources.test.js",
  "keyword-research/test/experiment-review-protection-helpers.js",
]);
const git = (repo, args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
const stamp = /(情報取得日|最終更新日): ?\d{4}年\d{1,2}月\d{1,2}日/g;
const urgency = /<p class="urgency">[^<]*<\/p>/g;

export function permittedGeneratedUpdate(path, before, after, readCurrent) {
  if (/^docs\/articles\/[^/]+\.html$/.test(path)) {
    // Existing urgency text may expire; adding/replacing claims, CTA, links or
    // other article content is not made legitimate by its generated location.
    const oldClaims = before.match(urgency) ?? [], newClaims = after.match(urgency) ?? [];
    return newClaims.every((claim) => newClaims.filter(x=>x===claim).length <= oldClaims.filter(x=>x===claim).length) &&
      before.replace(stamp, "$1:").replace(urgency, "") === after.replace(stamp, "$1:").replace(urgency, "");
  }
  if (path === "docs/sitemap.xml") {
    const strip = (s) => s.replace(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g, "");
    return strip(before) === strip(after);
  }
  if (path === "sitemap-lastmod.json") {
    const old = JSON.parse(before), current = JSON.parse(after);
    if (JSON.stringify(Object.keys(old).sort()) !== JSON.stringify(Object.keys(current).sort())) return false;
    return Object.entries(current).every(([page, entry]) => {
      if (JSON.stringify(entry) === JSON.stringify(old[page])) return true;
      return Object.keys(entry).sort().join(",") === "hash,lastmod" &&
        /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod ?? "") &&
        entry.hash === contentHash(readCurrent(`docs/${page}`));
    });
  }
  return false;
}

export function captureProtectedTree(repo) {
  const files = [...new Set(git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
  return Object.fromEntries(files.map((path) => {
    const file = join(repo, path);
    try {
      const stat = lstatSync(file), value = stat.isSymbolicLink() ? `SYMLINK:${readlinkSync(file)}` : readFileSync(file);
      return [path, createHash("sha256").update(value).digest("hex")];
    } catch (error) { if (error.code === "ENOENT") return [path, "MISSING"]; throw error; }
  }));
}
export function assertProtectedTreeUnchanged(before, after) { assert.deepEqual(after, before, "CLI changed a protected file or file identity"); }

export function assertHistoricalProtection(repo, { base, modules = {} }) {
  const historical = new Set(git(repo, ["ls-tree", "-r", "--name-only", base]).trim().split("\n"));
  const changed = git(repo, ["diff", "--name-only", base, "--", ...historical]).trim().split("\n").filter(Boolean);
  for (const path of changed) {
    if (approvedTestEdits.has(path) && path !== GUARD_PATH || path === "package.json") continue;
    const before = git(repo, ["show", `${base}:${path}`]);
    let after; try { after = readFileSync(join(repo, path), "utf8"); } catch { assert.fail(`Protected asset deleted: ${path}`); }
    if (path === WORKFLOW_PATH) {
      assert(isApprovedDailyAuditChange(before, after), "Only the explicitly authorized audit-only daily workflow may replace the old publisher");
      continue;
    }
    if (path === GUARD_PATH) {
      assert(isApprovedDailyGuardChange(before, after), "Only the sealed, file-specific daily audit guard maintenance is authorized");
      continue;
    }
    if (path === "docs/rankings/senior-cat-food.html" && permittedSeniorCatTrackingUpdate(before, after)) continue;
    if (path === "keyword-research/search-trial-analytics-clients.js" && permittedSeniorCatQaQueryUpdate(before, after)) continue;
    if (permittedNullObservationUpdate(path, before, after)) continue;
    if (path === "strategy/experiments.json") {
      validateReviewClosures(JSON.parse(before), JSON.parse(after),
        JSON.parse(readFileSync(join(repo, "strategy/experiment-reviews/2026-11-09/registry-closures.json"), "utf8")),
        JSON.parse(readFileSync(join(repo, "strategy/experiment-reviews/2026-11-09/evidence.json"), "utf8")));
      continue;
    }
    assert(permittedGeneratedUpdate(path, before, after, (p) => readFileSync(join(repo, p), "utf8")), `Unapproved protected change: ${path}`);
  }
  for (const [directory, approvedRef] of Object.entries(modules)) {
    const expected = git(repo, ["ls-tree", "-r", "--name-only", approvedRef, "--", directory]).trim().split("\n").filter(Boolean).sort();
    const current = Object.keys(captureProtectedTree(repo)).filter((p) => p.startsWith(`${directory}/`)).sort();
    assert.deepEqual(current, expected, `Protected module file identities changed: ${directory}`);
    assert.equal(git(repo, ["diff", "--name-only", approvedRef, "--", directory]), "", `Protected module changed: ${directory}`);
  }
  const expectedArticles = [...historical].filter((p) => /^docs\/articles\/[^/]+\.html$/.test(p)).sort();
  const actualArticles = Object.keys(captureProtectedTree(repo)).filter((p) => /^docs\/articles\/[^/]+\.html$/.test(p)).sort();
  assert.deepEqual(actualArticles, expectedArticles, "Existing article identities changed");
}
