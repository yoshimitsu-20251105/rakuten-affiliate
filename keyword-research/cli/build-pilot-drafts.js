#!/usr/bin/env node
// npm run keywords:build-pilot-drafts -- --source-run <runDir> --approved-file <approval.json> [--run-id <id>]
//
// 【Phase 3A: 非公開下書きページ生成】人間が承認したキーワードだけを、保存済みの
// keywords:gkp-dry-run実行結果(source run、rakutenSource=live・status=completedのみ)
// から、gitignore対象の非公開ディレクトリへ下書きHTMLへ変換する。
//
// 【重要】既存サイト(docs/)・日次パイプライン(generate-site.js/select-products.js/
// GitHub Actions)への接続・公開は一切行わない。楽天/Google/Search Console APIも
// 呼び出さない(保存済みのsource runを読み取り専用で使うだけ)。
//
// KEYWORD_RESEARCH_DRAFTS_ENABLED=true を明示的に設定しない限り実行できない
// (既定値false、実験的機能のfeature flag)。

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPilotDrafts } from "../pilot-draft-build.js";
import { resolveInputPath } from "../gkp-path-resolve.js";
import { parseArgs, nowJstIso } from "./args.js";
import { getCodeCommit, sanitizeRunId, createExclusiveRunDir, writeFailureMetadata } from "./gkp-cli-common.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const OUTPUT_ROOT_URL = new URL("../output/pilot-drafts/", import.meta.url);
const OUTPUT_ROOT = OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const LOG = "[keywords:build-pilot-drafts]";

async function main() {
  if (process.env.KEYWORD_RESEARCH_DRAFTS_ENABLED !== "true") {
    console.error(
      `${LOG} KEYWORD_RESEARCH_DRAFTS_ENABLED=true が必要です(既定値はfalse)。` +
        `実験的機能のため明示的に有効化してください(例: KEYWORD_RESEARCH_DRAFTS_ENABLED=true npm run keywords:build-pilot-drafts -- ...)。`
    );
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args["source-run"] || !args["approved-file"]) {
    console.error(`${LOG} --source-run と --approved-file の両方を指定してください`);
    process.exitCode = 1;
    return;
  }

  let sourceRunDir;
  try {
    sourceRunDir = resolveInputPath(args["source-run"]);
  } catch (e) {
    console.error(`${LOG} --source-run の解決に失敗しました: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const runId = sanitizeRunId(args["run-id"] || nowJstIso());
  const outDir = `${OUTPUT_ROOT}${runId}/`;

  console.log(`${LOG} source run: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 承認ファイル: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 出力先: ${outDir}`);

  // --- 全ゲートの検証をここで完結させる(1件でも失敗すれば、この時点では
  //     出力先ディレクトリを一切作らない。プリフライト失敗はメタデータを残さない) ---
  const result = await buildPilotDrafts({ sourceRunDir, approvedFilePath: args["approved-file"], projectRoot: PROJECT_ROOT });

  if (!result.ok) {
    console.error(`${LOG} 生成を拒否しました(いずれかの条件を満たさないため全件生成しません):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${LOG} 全ゲート通過。下書きを生成します(${result.drafts.length}件)`);
  console.log(`${LOG}   sourceRunId: ${result.sourceRunId}`);
  console.log(`${LOG}   candidateSetHash: ${result.candidateSetHash}`);
  console.log(`${LOG}   approvedFileHash: ${result.approvedFileHash}`);

  try {
    await createExclusiveRunDir(outDir, OUTPUT_ROOT);
  } catch (e) {
    console.error(`${LOG} ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const codeCommit = getCodeCommit(new URL("../../", import.meta.url));
    const manifestEntries = [];
    for (const draft of result.drafts) {
      const filename = `${draft.slug}.html`;
      await writeFile(`${outDir}${filename}`, draft.html, "utf-8");
      manifestEntries.push({ slug: draft.slug, normalizedKeyword: draft.normalizedKeyword, title: draft.title, filename });
      console.log(`${LOG}   生成: ${filename}(${draft.normalizedKeyword})`);
    }

    await writeFile(`${outDir}manifest.json`, JSON.stringify({ runId, generatedAt: new Date().toISOString(), drafts: manifestEntries }, null, 2), "utf-8");
    await writeFile(`${outDir}validation-report.md`, `# Phase 3A 下書き生成 検証レポート\n\n` + result.validationReportLines.map((l) => `- ${l}`).join("\n") + "\n", "utf-8");
    await writeFile(
      `${outDir}run-metadata.json`,
      JSON.stringify(
        {
          runId,
          executedAt: new Date().toISOString(),
          commandMode: "build-pilot-drafts",
          status: "completed",
          codeCommit,
          sourceRunId: result.sourceRunId,
          candidateSetHash: result.candidateSetHash,
          approvedFileHash: result.approvedFileHash,
          generatedCount: result.drafts.length,
          slugs: result.drafts.map((d) => d.slug),
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log(`${LOG} 完了(status=completed): ${result.drafts.length}件生成`);
    console.log(`${LOG} 出力先: ${outDir}`);
    console.log(`${LOG}(既存サイト・日次パイプラインへの接続・公開は一切行っていません。楽天/Google/Search Console APIは呼び出していません)`);
  } catch (e) {
    await writeFailureMetadata(outDir, runId, "build-pilot-drafts", e);
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
