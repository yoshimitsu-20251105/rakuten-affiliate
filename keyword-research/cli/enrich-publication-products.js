#!/usr/bin/env node
// npm run keywords:enrich-publication-products -- --source-run <runDir> --publication-approved-file <publicationApproval.json> --rakuten-source live --run-id <runId>
//
// 【Phase 3B 段階B: 人間承認済み商品の限定的な楽天商品補完】
// 対象は商品公開承認ファイルで人間が承認した商品だけ。1キーワードにつき楽天商品検索1回
// (承認ページ数が論理検索回数の上限)。取得するのは画像URL・現在価格・現在のレビュー・
// affiliateUrl・itemUrl・在庫上の存在確認のみ。fixtureフォールバックは行わない
// (--rakuten-source live を明示指定した場合のみ実行し、認証情報が無ければAPI呼び出し
// 0件で非ゼロ終了する)。
//
// 【重要】このCLIはPRレビュー・実装・テストの段階では実行しない。PRマージ後、
// 人間の明示指示を受けてから1回だけ実行すること。

import { writeFile } from "node:fs/promises";
import { searchRakutenItemsLive } from "../rakuten-match.js";
import { runPublicationEnrichment } from "../publication-enrichment-run.js";
import { ENRICHMENT_FIELD_ALLOWLIST } from "../publication-enrichment.js";
import { resolveInputPath } from "../gkp-path-resolve.js";
import { parseArgs, nowJstIso } from "./args.js";
import { sanitizeRunId, createExclusiveRunDir, writeFailureMetadata, getCodeCommit, writeArtifactHashes } from "./gkp-cli-common.js";

const OUTPUT_ROOT_URL = new URL("../output/publication-enrichment/", import.meta.url);
const OUTPUT_ROOT = OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const LOG = "[keywords:enrich-publication-products]";
const ARTIFACT_FILENAMES = ["enrichment-items.json"];

function isRakutenConfigured() {
  return Boolean(process.env.RAKUTEN_APP_ID && process.env.RAKUTEN_SECRET);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args["source-run"] || !args["publication-approved-file"]) {
    console.error(`${LOG} --source-run と --publication-approved-file の両方を指定してください`);
    process.exitCode = 1;
    return;
  }

  const rakutenSource = args["rakuten-source"];
  if (rakutenSource !== "live") {
    console.error(
      `${LOG} --rakuten-source live を明示的に指定してください(指定値: ${JSON.stringify(rakutenSource ?? null)})。` +
        `fixtureへのフォールバックは行いません(fail closed)。`
    );
    process.exitCode = 1;
    return;
  }

  if (!isRakutenConfigured()) {
    console.error(
      `${LOG} エラー: RAKUTEN_APP_ID/RAKUTEN_SECRETが未設定のため、--rakuten-source live を実行できません。` +
        `.envを読み込んで実行してください。fixtureへの自動フォールバックは行いません(fail closed、API呼び出し0件)。`
    );
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

  console.log(`${LOG} 実行モード: 限定的な楽天商品補完(承認済み商品のみ、1キーワード1検索)`);
  console.log(`${LOG} 【楽天データ源: LIVE(実際の楽天API、読み取り専用)】`);
  console.log(`${LOG} 出力先: ${outDir}`);

  const result = await runPublicationEnrichment({
    sourceRunDir,
    publicationApprovedFilePath: args["publication-approved-file"],
    searchFn: (query) => searchRakutenItemsLive(query),
  });

  if (!result.ok) {
    console.error(`${LOG} 生成を拒否しました:`);
    for (const e of result.errors) console.error(`  - ${e}`);
    console.error(`${LOG} 論理検索回数: ${result.logicalRakutenQueryCount} / APIエラー件数: ${result.apiErrorCount}`);
    process.exitCode = 1;
    return;
  }

  try {
    await createExclusiveRunDir(outDir, OUTPUT_ROOT);
  } catch (e) {
    console.error(`${LOG} ${e.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const enrichmentItems = Object.fromEntries(result.pages.map((p) => [p.slug, p.items]));
    await writeFile(`${outDir}enrichment-items.json`, JSON.stringify(enrichmentItems, null, 2), "utf-8");

    await writeFile(
      `${outDir}run-metadata.json`,
      JSON.stringify(
        {
          runId,
          executedAt: new Date().toISOString(),
          commandMode: "enrich-publication-products",
          status: "completed",
          codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
          rakutenSource: "live",
          sourceRunId: result.sourceRunId,
          candidateSetHash: result.candidateSetHash,
          publicationApprovedFileHash: result.publicationApprovedFileHash,
          logicalRakutenQueryCount: result.logicalRakutenQueryCount,
          apiErrorCount: result.apiErrorCount,
          slugs: result.pages.map((p) => p.slug),
          productCountBySlug: Object.fromEntries(result.pages.map((p) => [p.slug, p.items.length])),
          allowlistedFields: ENRICHMENT_FIELD_ALLOWLIST,
        },
        null,
        2
      ),
      "utf-8"
    );

    await writeArtifactHashes(outDir, ARTIFACT_FILENAMES);

    console.log(`${LOG} 完了(status=completed)`);
    console.log(`${LOG}   論理検索回数: ${result.logicalRakutenQueryCount} / APIエラー件数: ${result.apiErrorCount}`);
    for (const p of result.pages) console.log(`${LOG}   ${p.slug}: ${p.items.length}件`);
    console.log(`${LOG} 出力先: ${outDir}`);
    console.log(`${LOG}(既存source runは変更していません。認証情報・APIレスポンス全文は保存していません)`);
  } catch (e) {
    await writeFailureMetadata(outDir, runId, "enrich-publication-products", e);
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
