#!/usr/bin/env node
// npm run keywords:dry-run -- [--manual-csv <path>] [--use-google-ads] [--use-search-console]
// research → map-rakuten → report を一括実行する統合ドライランコマンド。
// 公開ページ・本番状態・commit・pushは一切行わない。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(scriptUrl, extraArgs) {
  const result = spawnSync(process.execPath, ["--env-file-if-exists=.env", fileURLToPath(scriptUrl), ...extraArgs], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const passthroughArgs = process.argv.slice(2);
console.log("=== [keywords:dry-run] Step 1/3: research ===");
run(new URL("./research.js", import.meta.url), passthroughArgs);
console.log("\n=== [keywords:dry-run] Step 2/3: map-rakuten ===");
run(new URL("./map-rakuten.js", import.meta.url), []);
console.log("\n=== [keywords:dry-run] Step 3/3: report ===");
run(new URL("./report.js", import.meta.url), []);
console.log("\n[keywords:dry-run] 完了(公開ページ・本番状態・commit・pushは行っていません)");
