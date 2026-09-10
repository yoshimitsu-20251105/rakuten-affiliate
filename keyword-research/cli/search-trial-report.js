#!/usr/bin/env node
// npm run analytics:search-trial-report -- --from <YYYY-MM-DD> --to <YYYY-MM-DD> --run-id <runId> [--previous-run-id <runId>]
//
// 【Phase 3C: 検索公開試験(30日間)の成果測定レポート】
// 検索表示→検索クリック→ページ閲覧→楽天CTAクリック→注文・成果報酬の流れを
// ページ単位(keyword-research/search-trial-pages.json記載の対象のみ)で確認できる
// レポートを生成する。既存のGA4 Data API / Search Console API接続(読み取り専用、
// credentials/ga-search-console-key.jsonを再利用)以外の外部APIは呼び出さない。
// 楽天APIは呼び出さない。Search Consoleへのサイトマップ送信・インデックス登録
// リクエストも送信しない。
//
// 公開ページ・商品データ・generate-site.js・GitHub Actionsは一切変更しない
// (このCLIはdocs/配下に何も書き込まない、読み取り専用のレポート生成のみ)。
//
// 【fail closed】次の場合は非ゼロ終了し、部分的な出力を一切残さない:
// 日付形式不正・from>to・対象期間が試験期間外・runId不正・同一runIdの出力が存在・
// 設定JSON不正・対象ページ重複・GA4/Search Consoleのレスポンス形式不正。
// 検証とデータ取得をすべてメモリ上で完了させてから、最後にまとめて書き込む
// (途中で失敗した場合はディレクトリ自体を作成しない)。
//
// 一方のAPIが権限不足・データ未反映の場合は、その項目だけをNOT_AVAILABLE等として
// 記録し、処理全体は失敗させない(取得できた他の事実まで失わない)。

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, nowJstIso } from "./args.js";
import { getCodeCommit, sanitizeRunId, createExclusiveRunDir } from "./gkp-cli-common.js";
import { buildSearchTrialReport } from "../search-trial-report-build.js";
import { renderReportMarkdown, renderReportJson } from "../search-trial-report-render.js";

const LOG = "[analytics:search-trial-report]";

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../search-trial-pages.json", import.meta.url));
const DEFAULT_DOCS_DIR = fileURLToPath(new URL("../../docs/", import.meta.url));
const DEFAULT_OUTPUT_ROOT = fileURLToPath(new URL("../output/search-trial-reports/", import.meta.url));

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.from || !args.to || !args["run-id"]) {
    console.error(`${LOG} --from と --to と --run-id のすべてを指定してください`);
    process.exitCode = 1;
    return;
  }

  const runId = args["run-id"];
  if (runId !== sanitizeRunId(runId)) {
    console.error(`${LOG} --run-id が不正です(英数字・ハイフン・アンダースコアのみ使用できます): ${runId}`);
    process.exitCode = 1;
    return;
  }

  // 【テスト専用】実docs/・実search-trial-pages.json・実output/を一切使わずに
  // このCLIを検証できるようにするための隔離用オプション(本番運用では指定しない)。
  const searchTrialConfigPath = args["search-trial-config"] ?? DEFAULT_CONFIG_PATH;
  const docsDirPath = args["docs-dir"] ? `${args["docs-dir"].replace(/[\\/]+$/, "")}/` : DEFAULT_DOCS_DIR;
  const outputRoot = args["output-dir"] ? `${args["output-dir"].replace(/[\\/]+$/, "")}/` : DEFAULT_OUTPUT_ROOT;

  let previousReport = null;
  if (args["previous-run-id"]) {
    const previousPath = `${outputRoot}${args["previous-run-id"]}/report.json`;
    if (!existsSync(previousPath)) {
      console.error(`${LOG} --previous-run-id で指定されたレポートが見つかりません: ${args["previous-run-id"]}`);
      process.exitCode = 1;
      return;
    }
    try {
      previousReport = JSON.parse(await readFile(previousPath, "utf-8"));
    } catch (e) {
      console.error(`${LOG} 前回レポートの読込に失敗しました: ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }

  let report;
  try {
    report = await buildSearchTrialReport({
      fromDate: args.from,
      toDate: args.to,
      runId,
      searchTrialConfigPath,
      docsDirPath,
      previousReport,
    });
  } catch (e) {
    console.error(`${LOG} レポート生成を中止しました: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const outDir = `${outputRoot}${runId}/`;
  try {
    await createExclusiveRunDir(outDir, outputRoot);
  } catch (e) {
    console.error(`${LOG} ${e.message}`);
    process.exitCode = 1;
    return;
  }

  await writeFile(`${outDir}report.md`, renderReportMarkdown(report), "utf-8");
  await writeFile(`${outDir}report.json`, renderReportJson(report), "utf-8");
  await writeFile(
    `${outDir}run-metadata.json`,
    JSON.stringify(
      {
        runId,
        executedAt: new Date().toISOString(),
        commandMode: "search-trial-report",
        status: "completed",
        codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
        requestedPeriod: { from: args.from, to: args.to },
        previousRunId: args["previous-run-id"] ?? null,
        pageCount: report.pages.length,
        dataGapCount: report.dataGaps.length,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`${LOG} 完了(status=completed): ${outDir}`);
  console.log(`${LOG}   対象ページ: ${report.pages.length}件`);
  console.log(`${LOG}   データ不足・取得不能項目: ${report.dataGaps.length}件`);
  if (report.qaClickNotice) {
    console.log(`${LOG}   注意: ${report.qaClickNotice}`);
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
