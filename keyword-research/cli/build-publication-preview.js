#!/usr/bin/env node
// npm run keywords:build-publication-preview -- --source-run <runDir> --publication-approved-file <publicationApproval.json> --enrichment-run <enrichmentRunDir> --run-id <runId>
//
// 【Phase 3B 段階C: 収益化機能を含む非公開プレビュー生成】
// KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED=true を明示的に設定しない限り実行できない
// (既定値false、実験的機能のfeature flag)。楽天/Google/Search Console APIは一切呼び出さない
// (保存済みのsource run・承認ファイル・レビュー資料・補完データを読み取り専用で使うだけ)。
//
// 【重要】既存サイト(docs/)・日次パイプライン(generate-site.js/select-products.js/
// GitHub Actions)への接続・公開は一切行わない。

import { writeFile } from "node:fs/promises";
import { buildPublicationPreview } from "../publication-preview-build.js";
import { resolveInputPath } from "../gkp-path-resolve.js";
import { parseArgs, nowJstIso } from "./args.js";
import { getCodeCommit, sanitizeRunId, createExclusiveRunDir, writeFailureMetadata } from "./gkp-cli-common.js";

const OUTPUT_ROOT_URL = new URL("../output/publication-previews/", import.meta.url);
const OUTPUT_ROOT = OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const LOG = "[keywords:build-publication-preview]";

async function main() {
  if (process.env.KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED !== "true") {
    console.error(
      `${LOG} KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED=true が必要です(既定値はfalse)。` +
        `実験的機能のため明示的に有効化してください。`
    );
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (!args["source-run"] || !args["publication-approved-file"] || !args["enrichment-run"]) {
    console.error(`${LOG} --source-run と --publication-approved-file と --enrichment-run のすべてを指定してください`);
    process.exitCode = 1;
    return;
  }

  let sourceRunDir, enrichmentRunDir;
  try {
    sourceRunDir = resolveInputPath(args["source-run"]);
  } catch (e) {
    console.error(`${LOG} --source-run の解決に失敗しました: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    enrichmentRunDir = resolveInputPath(args["enrichment-run"]);
  } catch (e) {
    console.error(`${LOG} --enrichment-run の解決に失敗しました: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  const runId = sanitizeRunId(args["run-id"] || nowJstIso());
  const outDir = `${OUTPUT_ROOT}${runId}/`;

  console.log(`${LOG} source run: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 商品公開承認ファイル: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 補完データ: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 出力先: ${outDir}`);

  const result = await buildPublicationPreview({
    sourceRunDir,
    publicationApprovedFilePath: args["publication-approved-file"],
    enrichmentRunDir,
  });

  if (!result.ok) {
    console.error(`${LOG} 生成を拒否しました(いずれかの条件を満たさないため全件生成しません):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${LOG} 全ゲート通過。プレビューを生成します(${result.drafts.length}件)`);
  console.log(`${LOG}   sourceRunId: ${result.sourceRunId}`);
  console.log(`${LOG}   publicationApprovedFileHash: ${result.publicationApprovedFileHash}`);
  console.log(`${LOG}   enrichmentArtifactHash: ${result.enrichmentArtifactHash}`);

  try {
    await createExclusiveRunDir(outDir, OUTPUT_ROOT);
  } catch (e) {
    console.error(`${LOG} ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    for (const draft of result.drafts) {
      await writeFile(`${outDir}${draft.slug}.html`, draft.html, "utf-8");
      console.log(`${LOG}   生成: ${draft.slug}.html`);
    }

    await writeFile(
      `${outDir}validation-report.md`,
      `# Phase 3B 公開前プレビュー生成 検証レポート\n\n` + result.validationReportLines.map((l) => `- ${l}`).join("\n") + "\n",
      "utf-8"
    );

    await writeFile(
      `${outDir}run-metadata.json`,
      JSON.stringify(
        {
          runId,
          executedAt: new Date().toISOString(),
          commandMode: "build-publication-preview",
          status: "completed",
          codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
          sourceRunId: result.sourceRunId,
          candidateSetHash: result.candidateSetHash,
          publicationApprovedFileHash: result.publicationApprovedFileHash,
          enrichmentArtifactHash: result.enrichmentArtifactHash,
          generatedCount: result.drafts.length,
          slugs: result.drafts.map((d) => d.slug),
          productCountBySlug: result.productCountBySlug,
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log(`${LOG} 完了(status=completed): ${result.drafts.length}件生成`);
    console.log(`${LOG} 出力先: ${outDir}`);
    console.log(`${LOG}(既存サイト・日次パイプラインへの接続・公開は一切行っていません。楽天/Google APIは呼び出していません)`);
  } catch (e) {
    await writeFailureMetadata(outDir, runId, "build-publication-preview", e);
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
