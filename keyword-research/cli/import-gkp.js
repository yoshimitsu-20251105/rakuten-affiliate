#!/usr/bin/env node
// npm run keywords:import-gkp -- --dog-csv "<犬用CSV>" --cat-csv "<猫用CSV>" [--run-id <id>]
//
// Googleキーワードプランナーの犬用・猫用CSVを取り込み、文字コード・区切り文字の
// 自動判定 → 結合 → 正規化・重複統合 → 需要スコア算出(businessValidated判定含む)
// までを行う。楽天APIは一切呼び出さない(需要分析だけを行うコマンド)。
// 公開ページ・本番状態・承認状態は一切変更しない。

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { runMapRakuten } from "../pipeline.js";
import { writeReports } from "../report.js";
import { writeConvertedAllCsv, writeNormalizedKeywordsCsv } from "../gkp-report.js";
import { importAndNormalizeGkp } from "../gkp-import.js";
import { parseArgs, nowJstIso } from "./args.js";

const OUTPUT_ROOT = new URL("../output/gkp-runs/", import.meta.url);

function getCodeCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: new URL("../../", import.meta.url), encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function sanitizeRunId(id) {
  return id.replace(/[^A-Za-z0-9_-]/g, "-");
}

async function writeFailureMetadata(outDirUrl, runId, commandMode, error) {
  try {
    await mkdir(outDirUrl, { recursive: true });
    await writeFile(
      new URL("run-metadata.json", outDirUrl),
      JSON.stringify({ runId, executedAt: new Date().toISOString(), commandMode, status: "failed", error: error.message }, null, 2),
      "utf-8"
    );
  } catch {
    // メタデータ書き込み自体に失敗しても、元のエラーで終了することを優先する
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = sanitizeRunId(args["run-id"] || nowJstIso());
  const outDirUrl = new URL(`${runId}/`, OUTPUT_ROOT);
  const outDir = outDirUrl.pathname.replace(/^\/([A-Za-z]):/, "$1:");

  if (existsSync(outDir)) {
    console.error(`[keywords:import-gkp] 出力先が既に存在します(上書きしません): ${outDir}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[keywords:import-gkp] 入力ファイル(犬用): ${args["dog-csv"] ?? "(未指定)"}`);
  console.log(`[keywords:import-gkp] 入力ファイル(猫用): ${args["cat-csv"] ?? "(未指定)"}`);
  console.log(`[keywords:import-gkp] 実行モード: import-gkp(取込・需要分析のみ、楽天APIは呼び出しません)`);
  console.log(`[keywords:import-gkp] 出力先: ${outDir}`);

  try {
    const result = await importAndNormalizeGkp({
      dogCsvPath: args["dog-csv"],
      catCsvPath: args["cat-csv"],
      onFilesParsed: ({ dogMeta, catMeta, originalRowCount }) => {
        console.log(`[keywords:import-gkp] 犬用CSV: encoding=${dogMeta.encoding} delimiter=${dogMeta.delimiter} 行数=${dogMeta.rowCount}`);
        console.log(`[keywords:import-gkp] 猫用CSV: encoding=${catMeta.encoding} delimiter=${catMeta.delimiter} 行数=${catMeta.rowCount}`);
        console.log(`[keywords:import-gkp] 対象期間: 犬=${dogMeta.periodStart}〜${dogMeta.periodEnd} / 猫=${catMeta.periodStart}〜${catMeta.periodEnd}`);
        console.log(`[keywords:import-gkp] 元データ件数(結合後): ${originalRowCount}件`);
      },
    });

    // 需要分析のみ(楽天APIを一切呼ばない)。skipRakuten:trueで全候補を
    // rakutenLookupStatus=NOT_RUN/rakutenSupplyStatus=NOT_EVALUATEDとして扱う
    // (既存レポート列(writeReports)をそのまま再利用するため)。
    const mapped = await runMapRakuten(result.researchResult, { skipRakuten: true });

    await mkdir(outDir, { recursive: true });
    await writeConvertedAllCsv(result.observations, outDir);
    await writeNormalizedKeywordsCsv(mapped, outDir);

    const { counts } = await writeReports(
      { candidates: mapped, sourceMetas: result.researchResult.sourceMetas, config: result.researchResult.config },
      {
        outDir,
        mode: "import-gkp(需要分析のみ、楽天APIは未実行)",
        runId,
        commandMode: "import-gkp",
        rakutenSource: null,
        codeCommit: getCodeCommit(),
        inputFiles: result.inputFiles,
        inputFileHashes: result.inputFileHashes,
        sourceProvider: "google_keyword_planner",
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        originalRowCount: result.originalRowCount,
        normalizedCount: mapped.length,
        selectedCount: 0,
      }
    );

    console.log(`[keywords:import-gkp] 完了`);
    console.log(`  businessValidated=true: ${counts.businessValidatedCount}件`);
    console.log(`  医療・健康除外: 医療=${counts.medicalReviewCount}件 / 健康訴求=${counts.healthReviewCount}件`);
    console.log(`  正規化後件数: ${mapped.length}件`);
    console.log(`  出力先: ${outDir}`);
    console.log(`(このコマンドは楽天APIを呼び出していません。公開ページ・本番状態・承認状態・commit・pushは一切行っていません)`);
  } catch (e) {
    await writeFailureMetadata(outDirUrl, runId, "import-gkp", e);
    console.error(`[keywords:import-gkp] エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`[keywords:import-gkp] 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
