import { createHash } from "node:crypto";

export const BASE_COMMIT = "23ebcb3b66ca1765b723791bf5a7b4d6e688a944";
export const WORKFLOW_PATH = ".github/workflows/daily-pipeline.yml";
export const GUARD_PATH = "keyword-research/test/experiment-review-protection-helpers.js";
export const OLD_WORKFLOW_SHA256 = "53ae16cb3603570e3e1ee33d6dab3b43c184a3e07f76adfe191d7c4a911a2042";
// A single authorized test-guard edit, never an exemption for its other rules.
export const APPROVED_GUARD_SHA256 = "bb932534c6bbd35e33c1ac079d2ce8a2f5c47c9826d50e7a08b8db61e575ce0b";
export const OLD_GUARD_SHA256 = "9b788a870c2280f03ad465d651be1e5cde7276fd735e60d3232e5fe60f0bda7d";
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

// These tests use only read-only repository access and private temporary data.
// Git-fixture tests that perform synthetic add/commit are run locally in npm test,
// not by the scheduled job. No publisher or browser is part of this command.
export const FOCUSED_COMMAND = "node --test " + [
  "keyword-research/test/publishing-safety-model.test.js",
  "keyword-research/test/publishing-safety-store.test.js",
  "keyword-research/test/publishing-safety-cli.test.js",
  "keyword-research/test/experiment-review-closure.test.js",
  "keyword-research/test/daily-workflow-fail-closed.test.js",
].join(" ");

export const DAILY_WORKFLOW = {
  name: "日次の監査・検証のみ（公開なし）",
  on: { schedule: [{ cron: "7 22 * * *" }], workflow_dispatch: {} },
  permissions: { contents: "read", pages: "read" },
  jobs: {
    audit: {
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
      steps: [
        { name: "監査用checkout", uses: "actions/checkout@v4", with: { "fetch-depth": 0, "persist-credentials": false } },
        { name: "Node.js", uses: "actions/setup-node@v4", with: { "node-version": "22" } },
        { name: "strategy検証", run: "npm run strategy:validate" },
        { name: "Safety・実験終了・共通guard・保護対象の検証", run: FOCUSED_COMMAND },
        { name: "内部リンク検査", run: "node check-links.js" },
        { name: "公開見送り状態と検証結果", if: "${{ always() }}", run: "node daily-audit/cli.js --checks-status ${{ job.status }}" },
      ],
    },
  },
};

// JSON is a YAML-compatible workflow format. Parsing the entire document lets us
// reject extra jobs, steps, credentials, permissions and alternate shell paths.
export const WORKFLOW_TEXT = JSON.stringify(DAILY_WORKFLOW, null, 2) + "\n";
export const WORKFLOW_SHA256 = sha256(WORKFLOW_TEXT);
export function validateDailyWorkflow(text) {
  const value = JSON.parse(text);
  if (JSON.stringify(value) !== JSON.stringify(DAILY_WORKFLOW)) throw new Error("DAILY_WORKFLOW_CONTRACT_CHANGED");
  if (sha256(text) !== WORKFLOW_SHA256) throw new Error("DAILY_WORKFLOW_BYTES_CHANGED");
  return value;
}
export function isApprovedDailyAuditChange(before, after) {
  if (sha256(before) !== OLD_WORKFLOW_SHA256) return false;
  try { validateDailyWorkflow(after); return true; } catch { return false; }
}
export const isApprovedDailyGuardChange = (before, after) => sha256(before) === OLD_GUARD_SHA256 && sha256(after) === APPROVED_GUARD_SHA256;
