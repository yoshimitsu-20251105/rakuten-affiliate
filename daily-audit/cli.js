#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readSavedState, renderSummary, appendActionsSummary } from "./report.js";

const root = fileURLToPath(new URL("../", import.meta.url));
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--checks-status" || !["success", "failure", "cancelled"].includes(args[1])) throw new Error("INVALID_ARGUMENTS");
  const state = await readSavedState(root);
  const clean = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) === "";
  const summary = renderSummary(state, { checksStatus: args[1], clean });
  if (process.env.GITHUB_STEP_SUMMARY) await appendActionsSummary(process.env.GITHUB_STEP_SUMMARY, summary, root);
  console.log(summary);
  if (args[1] !== "success" || !clean || state.status === "UNKNOWN") process.exitCode = 1;
}
main().catch(() => { console.error("[daily-audit] 検証未完了。公開・投稿・通知の経路はありません。入力の詳細は非表示です。"); process.exitCode = 1; });
