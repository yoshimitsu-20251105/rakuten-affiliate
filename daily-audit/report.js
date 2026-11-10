import { readFile, realpath, open, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { sha256 } from "./policy.js";

export const NO_ACTIONS = Object.freeze({ canGenerate: false, canCommit: false, canPush: false, canPublish: false, canPost: false, canNotify: false, canUseBrowser: false });
const summaryPath = "strategy/experiment-reviews/2026-11-09/reselection-summary.json";

export function evaluateSavedState(registryBytes, summaryBytes) {
  const unknown = { status: "UNKNOWN", selectorRecommendationCount: null, plannerStatus: "UNKNOWN", plannerReasons: [], runningCount: null,
    monetizationLimit: null, source: summaryPath, scope: "SAVED_REVIEW_NOT_LIVE_PIPELINE_REPLAY", ...NO_ACTIONS };
  try {
    const registry = JSON.parse(registryBytes), saved = JSON.parse(summaryBytes);
    if (!Array.isArray(registry.items) || saved.registryRawHash !== sha256(registryBytes)) throw new Error();
    const count = saved.selector?.recommendationCount, planner = saved.planner;
    if (!Number.isInteger(count) || count < 0 || count > 1 || !["BLOCKED", "READY", "MANUAL_REVIEW_REQUIRED"].includes(planner?.status)) throw new Error();
    if (!Number.isInteger(planner.plans) || planner.plans < 0 || !Array.isArray(planner.reasons)) throw new Error();
    const reasonCodes = planner.reasons.map(r => r?.code);
    if (!reasonCodes.every(c => typeof c === "string" && /^[A-Z_]+$/.test(c))) throw new Error();
    if (count === 0 && (planner.status !== "BLOCKED" || planner.plans !== 0 || !reasonCodes.includes("NO_SELECTOR_RECOMMENDATION"))) throw new Error();
    if (planner.status === "READY" && (count !== 1 || planner.plans !== 1)) throw new Error();
    const statuses = ["PLANNED", "RUNNING", "SUCCESS", "FAILED", "INCONCLUSIVE", "STOPPED"];
    if (!registry.items.every(r => statuses.includes(r.status))) throw new Error();
    const running = registry.items.filter(r => r.status === "RUNNING").length;
    const capacity = saved.monetization;
    if (!Array.isArray(capacity) || capacity.length !== 1 || !Number.isInteger(capacity[0].count) || capacity[0].count < 0 || !Number.isInteger(capacity[0].limit) || capacity[0].limit < 0) throw new Error();
    // A saved capacity count is not fresh authority for a new RUNNING registry.
    // Current policy is no publication under ANY result, including READY.
    return { ...unknown, status: running ? "HELD_REGISTRY_REVIEW_REQUIRED" : count === 0 ? "HELD_NO_SELECTOR_RECOMMENDATION" : planner.status === "BLOCKED" ? "HELD_PLANNER_BLOCKED" : "AUDIT_ONLY_PUBLICATION_DISABLED",
      selectorRecommendationCount: count, plannerStatus: planner.status, plannerReasons: reasonCodes, runningCount: running,
      monetizationLimit: capacity[0].limit, savedMonetizationCount: capacity[0].count, sourceRegistryHash: saved.registryRawHash };
  } catch { return unknown; }
}

export async function readSavedState(root) {
  try {
    return evaluateSavedState(await readFile(resolve(root, "strategy/experiments.json")), await readFile(resolve(root, summaryPath)));
  } catch { return evaluateSavedState(null, null); }
}

export function renderSummary(state, { checksStatus, clean }) {
  const checksOK = checksStatus === "success" && clean && state.status !== "UNKNOWN";
  return [
    "## 日次監査：公開・投稿処理なし",
    checksOK ? "検証完了。安全に公開を見送りました。公開許可は発行していません。" : "検証未完了または不一致。公開・投稿は引き続き禁止です。",
    "",
    `- 検証: ${checksOK ? "PASS" : "FAIL"}`,
    `- working tree: ${clean ? "CLEAN" : "DIRTY_OR_UNVERIFIED"}`,
    `- Selector推薦数（保存済み）: ${state.selectorRecommendationCount ?? "UNKNOWN"}`,
    `- Planner（保存済み）: ${state.plannerStatus}`,
    `- Planner理由: ${state.plannerReasons.join(", ") || "UNKNOWN"}`,
    `- 状態: ${state.status}`,
    "- AUTO_PUBLISH: false（既存Safety Layerはdry-run専用）",
    "- 生成・git add/commit/push・公開・投稿・メール/通知・ブラウザ: 実行経路なし",
    "",
    `参照: ${summaryPath}`,
    "これは保存済みレビューと現在の実験台帳hashの照合です。非公開入力・Learning台帳を使う実データpipelineの再実行ではありません。",
    "UNKNOWNを0やREADYへ変換しません。推薦やREADYが将来得られても、このworkflowは公開しません。",
    "",
  ].join("\n");
}

export async function appendActionsSummary(path, text, root) {
  if (!isAbsolute(path) || (await lstat(path)).isSymbolicLink()) throw new Error("UNSAFE_SUMMARY_PATH");
  const actual = await realpath(path), repo = await realpath(root), rel = relative(repo, actual);
  if (!rel || !rel.startsWith("..") && !isAbsolute(rel)) throw new Error("SUMMARY_MUST_BE_OUTSIDE_REPOSITORY");
  const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("SUMMARY_MUST_BE_REGULAR_FILE");
    await file.writeFile(text);
  } finally { await file.close(); }
}
