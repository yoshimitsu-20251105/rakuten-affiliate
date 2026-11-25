import assert from "node:assert/strict";
import { cp, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

export const APPROVED_FOUNDATION_POLICY_SHA256 = "5eae7e9b817f5656230bb7493f0ad88c21de6f1826938bdf3c726a41f996a325";

export const approvedReports = new Set([
  "learning-engine/report.js", "experiment-selector/report.js", "acquisition-planner/report.js",
  "market-scanner/report.js", "opportunity-scorer/report.js", "funnel-measurement/cli.js",
]);
export const approvedTests = new Set([
  "keyword-research/test/acquisition-planner-report.test.js",
  "keyword-research/test/experiment-selector-report.test.js",
  "keyword-research/test/learning-engine-report.test.js",
  "keyword-research/test/learning-engine-store.test.js",
  "keyword-research/test/publishing-safety-store.test.js",
  "keyword-research/test/gkp-path-resolve.test.js",
  "keyword-research/test/funnel-cli.test.js",
  "keyword-research/test/experiment-review-protection-helpers.js",
  "keyword-research/test/daily-workflow-fail-closed.test.js",
  "keyword-research/test/market-scanner-report.test.js",
  "keyword-research/test/opportunity-scorer-report.test.js",
]);

export function assertReportOnly(source) {
  assert.match(source, /import \{ (?:assertReportRoot, )?writeAtomicReport \} from "\.\.\/lib\/atomic-report\.js"/);
  assert.match(source, /await writeAtomicReport\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(|\.request\s*\(|node:(?:https?|net|tls)|generate-site|generate-social-posts|run-pipeline|deploy-pages|git\s+(?:push|commit)|(?:canPublish|canPost|AUTO_PUBLISH)\s*:\s*true/);
}

export async function fixtureRepository(repo, root, paths) {
  await mkdir(root);
  for (const path of paths) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(join(repo, path), join(root, path), { recursive: true });
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "Fixture");
  return git;
}

// Node exposes POSIX access bits only on POSIX. Windows output inherits the
// private parent ACL, and the filesystem object must still have the expected type.
export function assertPrivateFileType(stat, mode) {
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(mode === 0o700 ? stat.isDirectory() : stat.isFile(), true);
  if (process.platform !== "win32") assert.equal(stat.mode & 0o777, mode);
}
