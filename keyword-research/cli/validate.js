#!/usr/bin/env node
// npm run keywords:validate -- [--approved-file <path>]
// 単体テスト・統合テストの実行(既存Quality Scoreの回帰テストを含む)。
// --approved-file を指定した場合は、そのファイルの形式検証も行う(承認はしない)。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { loadApprovalFile } from "../approval.js";
import { parseArgs } from "./args.js";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("[keywords:validate] node:test でテストスイートを実行します...");
  const runnerPath = fileURLToPath(new URL("./run-tests.js", import.meta.url));
  const result = spawnSync(process.execPath, [runnerPath], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("[keywords:validate] テストが失敗しました");
    process.exitCode = 1;
    return;
  }
  console.log("[keywords:validate] テスト成功");

  if (args["approved-file"]) {
    const config = await loadConfig();
    const { valid, errors, canonicalApprovedSet } = await loadApprovalFile(args["approved-file"], config);
    if (!valid) {
      console.error(`[keywords:validate] 承認ファイルの形式が不正です:`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[keywords:validate] 承認ファイル形式OK(${canonicalApprovedSet.size}件のキーワードを承認予定)`);
  }
}

main();
