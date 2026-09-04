#!/usr/bin/env node
// npm run keywords:report
// latest-matches.json を読み込み、reports/keyword-research/<日付>/ にレポートを出力する。

import { readFile } from "node:fs/promises";
import { writeReports } from "../report.js";
import { todayJst, nowJstIso } from "./args.js";

const OUTPUT_DIR = new URL("../output/", import.meta.url);

async function main() {
  let parsed;
  try {
    const raw = await readFile(new URL("latest-matches.json", OUTPUT_DIR), "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    console.error("[keywords:report] latest-matches.json が見つかりません。先に `npm run keywords:map-rakuten` を実行してください。");
    process.exitCode = 1;
    return;
  }

  const outDir = `reports/keyword-research/${todayJst()}`;
  const { summaryPath, counts } = await writeReports(
    { candidates: parsed.candidates, sourceMetas: parsed.sourceMetas, config: parsed.config },
    { outDir, mode: "dry-run", runId: nowJstIso() }
  );

  console.log(`[keywords:report] レポートを ${outDir}/ に出力しました`);
  console.log(`  優先候補=${counts.priorityCount} テスト候補=${counts.testCount} 継続観測=${counts.observeCount} 除外=${counts.rejectCount}`);
  console.log(`  医療関連除外=${counts.medicalExcluded} 公開要件充足(未承認)=${counts.publishTargetCount}`);
  console.log(`  ${summaryPath}`);
}

main().catch((e) => {
  console.error(`[keywords:report] エラー: ${e.message}`);
  process.exitCode = 1;
});
