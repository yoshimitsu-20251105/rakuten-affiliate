#!/usr/bin/env node
// npm run keywords:research -- [--dry-run] [--manual-csv <path>] [--use-google-ads] [--use-search-console]
// Source層からキーワード候補を収集し、正規化・意図分類・クラスター分類・重複統合まで実行する。
// 標準ではdry-run(公開・状態変更は一切行わない)。このコマンド単体でも公開系の副作用はない。

import { mkdir, writeFile } from "node:fs/promises";
import { runResearch } from "../pipeline.js";
import { parseArgs, nowJstIso } from "./args.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runResearch({
    manualCsvPath: args["manual-csv"],
    useGoogleAds: Boolean(args["use-google-ads"]),
    useSearchConsole: Boolean(args["use-search-console"]),
    useGoogleTrends: Boolean(args["use-google-trends"]),
  });

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(
    new URL("latest-candidates.json", OUTPUT_DIR),
    JSON.stringify({ runAt: nowJstIso(), ...result }, null, 2),
    "utf-8"
  );

  console.log(`[keywords:research] 候補${result.candidates.length}件を正規化・分類済み(重複統合後)`);
  for (const meta of result.sourceMetas) {
    console.log(`  - source=${meta.source} configured=${meta.configured} fallbackUsed=${meta.fallbackUsed}: ${meta.note}`);
  }
  console.log(`出力: keyword-research/output/latest-candidates.json`);
  console.log(`(dry-run: 公開ページ・本番状態・commit・pushは行っていません)`);
}

main().catch((e) => {
  console.error(`[keywords:research] エラー: ${e.message}`);
  process.exitCode = 1;
});
