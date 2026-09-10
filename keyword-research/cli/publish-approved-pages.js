#!/usr/bin/env node
// npm run keywords:publish-approved-pages -- --source-run <runDir> --publication-approved-file <publicationApproval.json> --enrichment-run <enrichmentRunDir>
//
// 【Phase 3B 試験公開: 承認済みページをdocs/へ直接接続する】
// KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED=true を明示的に設定しない限り実行できない
// (既定値false)。楽天/Google/Search Console APIは一切呼び出さない(段階Cと同じ
// buildPublicationPreview()を再利用し、保存済みの成果物を読み取り専用で使うだけ)。
//
// 【重要・試験公開の設計】
// - 生成するHTMLはDRAFTバナー・「【下書き・非公開】」タイトル接頭辞を含まない
//   (buildPublicationPreviewへisDraft:falseを渡す)が、noindex,nofollowは
//   テンプレート側で常に出力されるため維持される(検索エンジンには非公開のまま)。
// - docs/index.html・docs/rankings/all.html等、既存のナビゲーション・ハブページは
//   一切変更しない(generate-site.jsが日次で完全再生成するため、手動で追記しても
//   最短で翌日の自動実行時に消えてしまう。人間が直接URLを共有して確認する運用を想定)。
// - 出力先ファイルが既に存在する場合は上書きせず失敗する(fail closed)。
// - generate-site.js・select-products.js・日次GitHub Actionsは一切呼び出さない。
//
// 【2026-09-09 GA4計測対応】このCLIの目的の1つは「限定公開したページの閲覧が
// 既存GA4で計測できること」の確認そのものであるため、generate-site.js(GA未設定でも
// 黙って無計測のまま生成を続ける)とは異なり、GA_MEASUREMENT_IDが未設定の場合は
// fail closed(非ゼロ終了、docs/への書き込みを一切行わない)とする。新しいGA4
// プロパティは作成せず、既存の.envのGA_MEASUREMENT_IDをそのまま再利用するだけ。
// GA4 Data API・Search Console API等の外部APIは一切呼び出さない。
//
// 【2026-09-10 検索公開試験対応】--enable-search-index を明示的に指定した場合のみ、
// isDraft:false かつ allowSearchIndex:true でHTMLを再生成し、robots meta
// (noindex,nofollow)を出力しないページを作る(通常の公開ページと同じ挙動)。
// このモードは「既に試験公開済みのページを検索公開試験へ切り替える」ための更新専用
// モードであるため、通常モードと安全側の前提を反転させる:
//   - 通常モード: 出力先が既に存在すれば失敗する(新規公開、上書きしない)。
//   - --enable-search-index: 出力先が「存在しなければ」失敗する(更新対象が
//     存在することを前提とし、誤って未公開ページを新規に検索公開してしまうことを防ぐ)。
// サイト内リンクの追加やdocs/sitemap.xmlの更新はこのCLIの責務ではない
// (generate-site.js側の検索公開試験ページ一覧を参照する処理で別途対応する)。

import { writeFile, mkdir } from "node:fs/promises";
import { buildPublicationPreview } from "../publication-preview-build.js";
import { resolveInputPath } from "../gkp-path-resolve.js";
import { parseArgs, nowJstIso } from "./args.js";
import { getCodeCommit, sanitizeRunId } from "./gkp-cli-common.js";

const DEFAULT_DOCS_RANKINGS_URL = new URL("../../docs/rankings/", import.meta.url);
const DEFAULT_DOCS_RANKINGS_DIR = DEFAULT_DOCS_RANKINGS_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const AUDIT_OUTPUT_ROOT_URL = new URL("../output/publication-publish/", import.meta.url);
const AUDIT_OUTPUT_ROOT = AUDIT_OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const LOG = "[keywords:publish-approved-pages]";

async function main() {
  if (process.env.KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED !== "true") {
    console.error(
      `${LOG} KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED=true が必要です(既定値はfalse)。` +
        `docs/への実際の書き込みを伴うため、明示的に有効化してください。`
    );
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));

  // 【テスト専用】--docs-rankings-dir は自動テストが実docs/を一切書き換えずに
  // このCLIを検証できるようにするための隔離用オプション(未指定時は実際の
  // docs/rankings/を使う、本番運用では指定しない)。
  const DOCS_RANKINGS_DIR = args["docs-rankings-dir"]
    ? `${args["docs-rankings-dir"].replace(/[\\/]+$/, "")}/`
    : DEFAULT_DOCS_RANKINGS_DIR;

  if (!args["source-run"] || !args["publication-approved-file"] || !args["enrichment-run"]) {
    console.error(`${LOG} --source-run と --publication-approved-file と --enrichment-run のすべてを指定してください`);
    process.exitCode = 1;
    return;
  }

  // 【fail closed】このCLIの目的の1つが「GA4での計測確認」であるため、
  // GA_MEASUREMENT_ID未設定のまま計測タグなしで静かに公開することはしない。
  const gaMeasurementId = process.env.GA_MEASUREMENT_ID || "";
  if (!gaMeasurementId) {
    console.error(
      `${LOG} GA_MEASUREMENT_IDが未設定です(.envに設定するか、環境変数として渡してください)。` +
        `このCLIは公開ページの閲覧をGA4で計測できることの確認を目的の1つとしているため、` +
        `計測タグなしでの公開はfail closedとし、docs/への書き込みは行いません。`
    );
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

  console.log(`${LOG} source run: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 商品公開承認ファイル: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 補完データ: (指定済み、絶対パスはログに記録しません)`);
  console.log(`${LOG} 出力先: ${DOCS_RANKINGS_DIR}<slug>.html(既存のnavigation/hubページは変更しません)`);

  const enableSearchIndex = args["enable-search-index"] === true;

  const result = await buildPublicationPreview({
    sourceRunDir,
    publicationApprovedFilePath: args["publication-approved-file"],
    enrichmentRunDir,
    isDraft: false,
    gaMeasurementId,
    allowSearchIndex: enableSearchIndex,
  });

  if (!result.ok) {
    console.error(`${LOG} 生成を拒否しました(いずれかの条件を満たさないため公開しません):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const targetPaths = result.drafts.map((d) => ({ slug: d.slug, path: `${DOCS_RANKINGS_DIR}${d.slug}.html` }));
  const { existsSync } = await import("node:fs");

  if (enableSearchIndex) {
    // 【fail closed・更新モード】検索公開試験への切り替えは「既に公開済みのページ」に
    // 対してのみ許可する。未公開のページを誤ってこのモードで新規作成しない。
    const missing = targetPaths.filter((t) => !existsSync(t.path));
    if (missing.length > 0) {
      console.error(`${LOG} --enable-search-index は既存の公開ページを更新するモードです。次の出力先がまだ存在しません:`);
      for (const t of missing) console.error(`  - docs/rankings/${t.slug}.html`);
      process.exitCode = 1;
      return;
    }
  } else {
    // 【fail closed・通常モード】出力先ファイルが既に存在する場合は一切上書きしない。
    // 事前に全件チェックしてから書き込む(一部だけ公開されてしまう状態を避ける)。
    const alreadyExisting = targetPaths.filter((t) => existsSync(t.path));
    if (alreadyExisting.length > 0) {
      console.error(`${LOG} 出力先が既に存在するため、公開を中止しました(上書きしません):`);
      for (const t of alreadyExisting) console.error(`  - docs/rankings/${t.slug}.html`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`${LOG} 全ゲート通過。docs/rankings/へ書き込みます(${result.drafts.length}件、モード=${enableSearchIndex ? "検索公開試験への更新" : "新規公開"})`);
  console.log(`${LOG}   sourceRunId: ${result.sourceRunId}`);
  console.log(`${LOG}   publicationApprovedFileHash: ${result.publicationApprovedFileHash}`);
  console.log(`${LOG}   enrichmentArtifactHash: ${result.enrichmentArtifactHash}`);

  for (const t of targetPaths) {
    const draft = result.drafts.find((d) => d.slug === t.slug);
    // 通常モードは flag "wx"(排他作成、直前チェックとのTOCTOU競合に対する二重の安全策)。
    // --enable-search-index は既存ファイルの意図的な更新のため flag "w"(上書き)を使う。
    await writeFile(t.path, draft.html, { encoding: "utf-8", flag: enableSearchIndex ? "w" : "wx" });
    console.log(`${LOG}   ${enableSearchIndex ? "更新" : "公開"}: docs/rankings/${t.slug}.html`);
  }

  const runId = sanitizeRunId(args["run-id"] || nowJstIso());
  const auditDir = `${AUDIT_OUTPUT_ROOT}${runId}/`;
  await mkdir(auditDir, { recursive: true });
  await writeFile(
    `${auditDir}run-metadata.json`,
    JSON.stringify(
      {
        runId,
        executedAt: new Date().toISOString(),
        commandMode: enableSearchIndex ? "enable-search-index" : "publish-approved-pages",
        status: "completed",
        codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
        sourceRunId: result.sourceRunId,
        candidateSetHash: result.candidateSetHash,
        publicationApprovedFileHash: result.publicationApprovedFileHash,
        enrichmentArtifactHash: result.enrichmentArtifactHash,
        publishedSlugs: result.drafts.map((d) => d.slug),
        publishedPaths: targetPaths.map((t) => `docs/rankings/${t.slug}.html`),
        productCountBySlug: result.productCountBySlug,
        noindexMaintained: !enableSearchIndex,
        linkedFromNavigation: false,
        gaMeasurementTagIncluded: true,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`${LOG} 完了(status=completed): ${result.drafts.length}件${enableSearchIndex ? "更新(検索公開試験)" : "公開"}`);
  console.log(`${LOG}(docs/index.html・docs/rankings/all.html等の既存ナビゲーションは変更していません)`);
  console.log(
    enableSearchIndex
      ? `${LOG}(noindex,nofollowを解除しました。docs/sitemap.xmlへの反映は別途、検索公開試験ページ一覧の更新が必要です)`
      : `${LOG}(noindex,nofollowを維持しています。generate-site.js・日次パイプラインは呼び出していません)`
  );
  console.log(`${LOG}(既存サイトと同じGA4計測タグを含めています。GA_MEASUREMENT_IDの値自体はログに記録しません)`);
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
