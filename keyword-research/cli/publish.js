#!/usr/bin/env node
// 【非推奨(deprecated)】npm run keywords:publish は npm run keywords:export-approved の
// 旧名です。互換性のため残していますが、いずれ削除予定です。
//
// 【重要】このコマンドはサイトへの公開(commit・push・docs/への反映)を一切行いません。
// 「publish」という名前から誤解されやすいため、実際の処理内容が分かりやすい
// keywords:export-approved へ改名しました。行っているのは、承認ファイルと照合した
// 「承認済み・楽天照合ELIGIBLE・医療関連でない」候補だけを抽出して
// keyword-research/output/approved-candidates.json というmanifestファイルを
// 書き出すことだけです。

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

console.warn(
  "[keywords:publish] 【非推奨】このコマンド名は非推奨です。次回から `npm run keywords:export-approved` を使用してください。\n" +
    "[keywords:publish] 【重要】このコマンドはサイトへの公開を一切行いません(承認済み候補のmanifestファイルを出力するだけです)。"
);

const target = fileURLToPath(new URL("./export-approved.js", import.meta.url));
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
