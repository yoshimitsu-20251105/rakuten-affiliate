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
  console.log(`  [スコア帯(simulation/test only)] 優先候補相当=${counts.priorityCount} テスト候補相当=${counts.testCount} 継続観測相当=${counts.observeCount} 除外相当=${counts.rejectCount}`);
  console.log(
    `  [実運用判定] businessValidated=true: ${counts.businessValidatedCount}件 / 実運用上の優先候補=${counts.operationalPriorityCount} / 承認可能件数=${counts.eligibleForApprovalCount} / 出力可能件数=${counts.eligibleForExportCount}`
  );
  if (counts.businessValidatedCount === 0) {
    console.log(`  ⚠ businessValidated=trueが0件のため、実運用上の優先候補・承認可能候補・出力可能候補はすべて0件です。`);
  }
  console.log(`  医療関連除外=${counts.medicalExcluded}`);
  console.log(`  ${summaryPath}`);
}

main().catch((e) => {
  console.error(`[keywords:report] エラー: ${e.message}`);
  process.exitCode = 1;
});
