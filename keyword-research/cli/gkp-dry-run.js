#!/usr/bin/env node
// npm run keywords:gkp-dry-run -- --dog-csv "<犬用CSV>" --cat-csv "<猫用CSV>" --rakuten-source live --max-rakuten-keywords 100
//
// Googleキーワードプランナーの犬用・猫用CSV取込 → 正規化・重複統合 → 需要スコア算出 →
// 安全な候補選出(医療・健康訴求語を除外、購入意図あり、犬猫バランス、上限件数) →
// 楽天商品照合 → レポート・実行メタデータ出力、までを行う完全dry-run。
// 公開ページ・本番状態・承認状態・Phase3(既存サイトへの接続)は一切行わない。
//
// 【重要】--rakuten-source は必須(live/fixtureを明示指定しない完全dry-runはエラーにする)。
// --rakuten-source live は認証情報が無ければAPIを1件も呼ばず非ゼロ終了する(fixtureへの
// 自動フォールバックはしない)。--rakuten-source fixture は明示指定時のみ使用可能で、
// 承認・出力・掲載ゲートはすべて強制的にfalseになる(テストデータを実運用候補にしない)。

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { runMapRakuten } from "../pipeline.js";
import { writeReports } from "../report.js";
import {
  writeConvertedAllCsv,
  writeNormalizedKeywordsCsv,
  writeSelectedForRakutenCsv,
  writeExcludedKeywordsCsv,
  writeRakutenItemsJson,
} from "../gkp-report.js";
import { importAndNormalizeGkp } from "../gkp-import.js";
import { selectCandidatesForRakuten } from "../gkp-selection.js";
import { createStrictRakutenSearchFn } from "../gkp-rakuten-source.js";
import { parseArgs, nowJstIso } from "./args.js";
import {
  getCodeCommit,
  sanitizeRunId,
  createExclusiveRunDir,
  writeFailureMetadata,
  validateMaxRakutenKeywords,
  evaluateApiErrorRate,
  writeArtifactHashes,
} from "./gkp-cli-common.js";

// Phase 3A(pilot-draft-source-run.js)がsource run成果物の改変検知に使うハッシュ対象。
const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];

const OUTPUT_ROOT_URL = new URL("../output/gkp-runs/", import.meta.url);
const OUTPUT_ROOT = OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const API_ERROR_RATE_THRESHOLD = 0.5; // これを超えたら非ゼロ終了(異常な実行状態として報告)
const LOG = "[keywords:gkp-dry-run]";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = sanitizeRunId(args["run-id"] || nowJstIso());
  const outDir = `${OUTPUT_ROOT}${runId}/`;
  const rakutenSource = args["rakuten-source"];

  // --- preflight検証(ファイル・ネットワークに一切触れる前に完結させる。
  //     これらのエラーはメタデータを残さない仕様) ---
  if (rakutenSource !== "live" && rakutenSource !== "fixture") {
    console.error(
      `${LOG} --rakuten-source は "live" または "fixture" を明示的に指定してください` +
        `(指定値: ${JSON.stringify(rakutenSource ?? null)})。未指定の完全dry-runは安全のためエラーにします。` +
        ` 対処: --rakuten-source live (実際の楽天APIを使う) または --rakuten-source fixture (テストデータのみ)を指定してください。`
    );
    process.exitCode = 1;
    return;
  }
  const maxRakutenKeywordsResult = validateMaxRakutenKeywords(args["max-rakuten-keywords"]);
  if (!maxRakutenKeywordsResult.ok) {
    console.error(`${LOG} ${maxRakutenKeywordsResult.message} 対処: 1〜100の整数を指定してください(例: --max-rakuten-keywords 100)。`);
    process.exitCode = 1;
    return;
  }
  const maxRakutenKeywords = maxRakutenKeywordsResult.value;

  let searchFn;
  try {
    searchFn = createStrictRakutenSearchFn(rakutenSource); // live指定で認証情報が無ければここで即例外(API呼び出し0件)
  } catch (e) {
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    await createExclusiveRunDir(outDir, OUTPUT_ROOT);
  } catch (e) {
    console.error(`${LOG} ${e.message} 対処: --run-id で別の実行IDを指定するか、既存の出力先を確認してください。`);
    process.exitCode = 1;
    return;
  }

  console.log(`${LOG} 入力ファイル(犬用): ${args["dog-csv"] ?? "(未指定)"}`);
  console.log(`${LOG} 入力ファイル(猫用): ${args["cat-csv"] ?? "(未指定)"}`);
  console.log(`${LOG} 実行モード: gkp-dry-run(完全dry-run、楽天商品照合を含む)`);
  console.log(
    rakutenSource === "live"
      ? `${LOG} 【楽天データ源: LIVE(実際の楽天API、読み取り専用)】`
      : `${LOG} 【楽天データ源: FIXTURE(テストデータ・実運用不可)】`
  );
  console.log(`${LOG} 最大照合件数: ${maxRakutenKeywords}件`);
  console.log(`${LOG} 出力先: ${outDir}`);

  try {
    const result = await importAndNormalizeGkp({
      dogCsvPath: args["dog-csv"],
      catCsvPath: args["cat-csv"],
      onFilesParsed: ({ dogMeta, catMeta, originalRowCount }) => {
        console.log(`${LOG} 犬用CSV: encoding=${dogMeta.encoding} delimiter=${dogMeta.delimiter} 行数=${dogMeta.rowCount}`);
        console.log(`${LOG} 猫用CSV: encoding=${catMeta.encoding} delimiter=${catMeta.delimiter} 行数=${catMeta.rowCount}`);
        console.log(`${LOG} 対象期間: 犬=${dogMeta.periodStart}〜${dogMeta.periodEnd} / 猫=${catMeta.periodStart}〜${catMeta.periodEnd}`);
        console.log(`${LOG} 元データ件数(結合後): ${originalRowCount}件`);
      },
    });

    const allCandidates = result.researchResult.candidates;
    const { selected, excluded, poolStats } = selectCandidatesForRakuten(allCandidates, { maxKeywords: maxRakutenKeywords });
    console.log(
      `${LOG} 安全な候補選出: プール${poolStats.eligiblePoolCount}件(犬${poolStats.dogPoolCount}/猫${poolStats.catPoolCount}) → 選出${selected.length}件(犬${poolStats.selectedDogCount}/猫${poolStats.selectedCatCount})`
    );

    const selectedResearchResult = { candidates: selected, config: result.researchResult.config };
    let mapped = await runMapRakuten(selectedResearchResult, {
      searchFn: searchFn.search,
      usedFixtureFallback: searchFn.usedFixtureFallback,
    });

    // --rakuten-source fixture の場合、承認・出力・掲載ゲートを強制的にfalseへ倒す
    // (テストデータを実運用候補として扱わせない)。
    if (rakutenSource === "fixture") {
      mapped = mapped.map((c) => ({ ...c, eligibleForApproval: false, eligibleForExport: false, eligibleForPublish: false }));
    }

    const { apiErrorCount, attemptedCount, apiErrorRate, exceeded: apiErrorRateExceeded } = evaluateApiErrorRate(
      mapped,
      API_ERROR_RATE_THRESHOLD
    );
    const finalStatus = apiErrorRateExceeded ? "failed" : "completed";

    await mkdir(outDir, { recursive: true });
    await writeConvertedAllCsv(result.observations, outDir);
    await writeNormalizedKeywordsCsv(allCandidates, outDir);
    await writeSelectedForRakutenCsv(selected, outDir);
    await writeExcludedKeywordsCsv(excluded, outDir);
    await writeRakutenItemsJson(mapped, outDir);

    const { counts } = await writeReports(
      { candidates: mapped, sourceMetas: result.researchResult.sourceMetas, config: result.researchResult.config },
      {
        outDir,
        mode:
          rakutenSource === "fixture"
            ? "gkp-dry-run【テストデータ・実運用不可】(--rakuten-source fixture明示指定)"
            : "gkp-dry-run(--rakuten-source live)",
        runId,
        status: finalStatus,
        commandMode: "gkp-dry-run",
        rakutenSource,
        codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
        inputFiles: result.inputFiles,
        inputFileHashes: result.inputFileHashes,
        sourceProvider: "google_keyword_planner",
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        originalRowCount: result.originalRowCount,
        normalizedCount: allCandidates.length,
        selectedCount: selected.length,
        resultCounts: { apiErrorCount, attemptedCount, apiErrorRate },
      }
    );

    if (rakutenSource === "fixture") {
      // summary.mdの先頭に目立つ警告を追記する(spec: テストデータ・実運用不可)
      const existing = await readFile(`${outDir}/summary.md`, "utf-8");
      const banner =
        "# ⚠ テストデータ・実運用不可 ⚠\n" +
        "このレポートは --rakuten-source fixture (テスト用固定データ、実際の楽天在庫ではない)で" +
        "生成されました。eligibleForApproval/eligibleForExport/eligibleForPublishはすべて強制的にfalseです。\n\n";
      await writeFile(`${outDir}/summary.md`, banner + existing, "utf-8");
    }

    // 【2026-09-07 PR#5監査対応】成果物を書き終えた後にSHA-256を計算し、
    // run-metadata.jsonへartifactHashesを原子的に追記する(Phase 3Aの改変検知用)。
    await writeArtifactHashes(outDir, ARTIFACT_FILENAMES);

    console.log(`${LOG} 完了(status=${finalStatus})`);
    console.log(`  楽天データ源: ${rakutenSource}`);
    console.log(`  businessValidated=true: ${counts.businessValidatedCount}件`);
    console.log(`  医療・健康除外: 医療=${counts.medicalReviewCount}件 / 健康訴求=${counts.healthReviewCount}件`);
    console.log(`  正規化後件数: ${allCandidates.length}件`);
    console.log(`  楽天照合件数: ${selected.length}件`);
    console.log(`  PRIORITY=${counts.priorityCount} / TEST=${counts.testCount} / OBSERVE=${counts.observeCount} / REJECT=${counts.rejectCount}`);
    console.log(
      `  SUPPLY_NO_MATCH=${counts.supplyNoMatchDecisionCount} / SUPPLY_INSUFFICIENT=${counts.supplyInsufficientDecisionCount} / API_ERROR=${apiErrorCount}件(異常率${(apiErrorRate * 100).toFixed(1)}%)`
    );
    console.log(`  人間レビュー対象件数(要確認): ${mapped.flatMap((c) => c.rakuten.matches ?? []).filter((m) => m.status === "NEEDS_MANUAL_REVIEW").length}件`);
    console.log(`  承認候補件数: ${counts.eligibleForApprovalCount}件`);
    console.log(`  承認済み件数: ${counts.approvedCount}件(このコマンドは承認ファイルを参照しないため常に0)`);
    console.log(`  出力先: ${outDir}`);
    console.log(`(公開ページ・本番状態・承認状態・commit・pushは一切行っていません)`);

    if (apiErrorRateExceeded) {
      console.error(
        `${LOG} エラー: 楽天API異常率が基準(${Math.round(API_ERROR_RATE_THRESHOLD * 100)}%)を超えました` +
          `(${apiErrorCount}/${attemptedCount}件)。run-metadata.jsonのstatusはfailedです。` +
          ` 対処: 楽天APIの認証情報・ネットワーク状態を確認し、時間を置いて再実行してください。`
      );
      process.exitCode = 1;
    }
  } catch (e) {
    await writeFailureMetadata(outDir, runId, "gkp-dry-run", e);
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
