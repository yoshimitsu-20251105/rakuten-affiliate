#!/usr/bin/env node
// npm run keywords:prepare-publication-review -- --source-run <runDir> --approved-file <keywordApproval.json> --run-id <runId>
//
// 【Phase 3B 段階A: 公開候補商品レビュー資料の生成】
// 保存済みsource run(rakuten-items.json)の商品へ、公開ページ単位の厳格な必須属性・
// 医療健康安全性・商品関連性を再適用し、人間が確認するための内部レビュー資料
// (publication-review.md / publication-candidates.json)を作る。
//
// 【重要】このCLIは何も自動承認しない。楽天/Google/Search Console APIは一切
// 呼び出さない(保存済みのsource runを読み取り専用で使うだけ)。

import { writeFile } from "node:fs/promises";
import { loadSourceRun } from "../pilot-draft-source-run.js";
import { loadApprovalFile } from "../pilot-draft-approval.js";
import { buildPageReview } from "../publication-review.js";
import { PUBLICATION_PAGE_REQUIREMENTS } from "../publication-attributes.js";
import { loadConfig } from "../config.js";
import { computePublicationReviewHash } from "../hash-utils.js";
import { resolveInputPath } from "../gkp-path-resolve.js";
import { parseArgs, nowJstIso } from "./args.js";
import { sanitizeRunId, createExclusiveRunDir, writeFailureMetadata, getCodeCommit } from "./gkp-cli-common.js";

const OUTPUT_ROOT_URL = new URL("../output/publication-reviews/", import.meta.url);
const OUTPUT_ROOT = OUTPUT_ROOT_URL.pathname.replace(/^\/([A-Za-z]):/, "$1:");
const LOG = "[keywords:prepare-publication-review]";

function escapeMd(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function main() {
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

  const { valid: approvalValid, approval, approvedFileHash, errors: approvalErrors } = await loadApprovalFile(args["approved-file"]);
  if (!approvalValid) {
    console.error(`${LOG} 承認ファイルの検証に失敗しました:`);
    for (const e of approvalErrors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  const { valid: sourceRunValid, errors: sourceRunErrors, metadata, candidatesByKeyword } = await loadSourceRun(sourceRunDir);
  if (!sourceRunValid) {
    console.error(`${LOG} source runの検証に失敗しました:`);
    for (const e of sourceRunErrors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  if (approval.sourceRunId !== metadata.runId) {
    console.error(`${LOG} 承認ファイルのsourceRunIdがsource runの実際のrunIdと一致しません`);
    process.exitCode = 1;
    return;
  }
  if (approval.candidateSetHash !== metadata.candidateSetHash) {
    console.error(`${LOG} 承認ファイルのcandidateSetHashがsource runの実際のcandidateSetHashと一致しません`);
    process.exitCode = 1;
    return;
  }

  const safetyConfig = await loadConfig();

  const pages = [];
  const errors = [];
  for (const kw of approval.keywords) {
    const pageConfig = PUBLICATION_PAGE_REQUIREMENTS[kw.slug];
    if (!pageConfig) {
      errors.push(`slug「${kw.slug}」はPhase 3B対象ページとして定義されていません(publication-attributes.js)`);
      continue;
    }
    const candidate = candidatesByKeyword.get(kw.normalizedKeyword);
    if (!candidate) {
      errors.push(`normalizedKeyword「${kw.normalizedKeyword}」がsource run内に見つかりません`);
      continue;
    }
    const review = buildPageReview({ candidate, requiredAttributes: pageConfig.requiredAttributes, safetyConfig });
    pages.push({ slug: kw.slug, normalizedKeyword: kw.normalizedKeyword, title: kw.title, requiredAttributes: pageConfig.requiredAttributes, ...review });
  }

  if (errors.length > 0) {
    console.error(`${LOG} エラー(全件生成を拒否します):`);
    for (const e of errors) console.error(`  - ${e}`);
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
    const reviewHash = computePublicationReviewHash(pages.map((p) => ({ slug: p.slug, topCandidates: p.topCandidates })));

    const candidatesJson = {
      runId,
      sourceRunId: metadata.runId,
      candidateSetHash: metadata.candidateSetHash,
      keywordApprovedFileHash: approvedFileHash,
      reviewHash,
      pages: pages.map((p) => ({
        slug: p.slug,
        normalizedKeyword: p.normalizedKeyword,
        title: p.title,
        requiredAttributes: p.requiredAttributes,
        candidates: p.topCandidates.map((c) => ({
          itemCode: c.itemCode,
          itemPrice: c.itemPrice,
          reviewAverage: c.reviewAverage,
          reviewCount: c.reviewCount,
          shopName: c.shopName,
          qualityScore: c.qualityScore,
          verifiedAttributes: c.verifiedAttributes,
          needsFlavorSelectionNote: c.needsFlavorSelectionNote,
        })),
      })),
    };
    await writeFile(`${outDir}publication-candidates.json`, JSON.stringify(candidatesJson, null, 2), "utf-8");

    const mdLines = [
      `# Phase 3B 公開候補商品レビュー(内部確認専用、公開HTMLには使用しない)`,
      ``,
      `- runId: ${runId}`,
      `- sourceRunId: ${metadata.runId}`,
      `- reviewHash: ${reviewHash}`,
      ``,
    ];
    for (const p of pages) {
      mdLines.push(`## ${escapeMd(p.title)}(slug=${p.slug})`, ``);
      mdLines.push(`normalizedKeyword: ${escapeMd(p.normalizedKeyword)}`);
      mdLines.push(`必須属性: ${p.requiredAttributes.join(", ")}`, ``);
      mdLines.push(`### 店舗多様性`);
      mdLines.push(`- 異なる店舗数: ${p.diversity.distinctShopCount}(最低3店舗必要)`);
      mdLines.push(`- 上限(1店舗2件)超過店舗: ${p.diversity.overLimitShops.length > 0 ? p.diversity.overLimitShops.map(escapeMd).join(", ") : "なし"}`);
      if (p.sameSeriesGroups.length > 0) {
        mdLines.push(`- 同一シリーズ候補グループ: ${p.sameSeriesGroups.map((g) => `[${g.map((i) => i.itemCode).join(",")}]`).join(" / ")}`);
      }
      mdLines.push(``, `### 候補商品(上位${p.topCandidates.length}件、Quality Score順)`, ``);
      mdLines.push(`| itemCode | 元商品名 | 価格 | レビュー | shopName | Quality Score(内部) | 検証済み属性 | 不足属性 | 除外理由 | 要確認事項 |`);
      mdLines.push(`|---|---|---|---|---|---|---|---|---|---|`);
      for (const c of p.topCandidates) {
        const note = c.needsFlavorSelectionNote ? "複数フレーバー選択商品(表示上「購入時に豚肉タイプを選択してください」の注意文が必須)" : "";
        mdLines.push(
          `| ${c.itemCode} | ${escapeMd(c.itemName)} | ${c.itemPrice ?? "-"} | ${c.reviewAverage ?? "-"}(${c.reviewCount ?? "-"}件) | ${escapeMd(c.shopName)} | ${c.qualityScore ?? "-"} | ${c.verifiedAttributes.join(" / ") || "なし"} | ${c.missingAttributes.join(" / ") || "なし"} | ${c.exclusionReasons.join(",") || "なし"} | ${note} |`
        );
      }
      const excludedReviews = p.itemReviews.filter((r) => !r.eligible);
      if (excludedReviews.length > 0) {
        mdLines.push(``, `### 除外商品(参考、${excludedReviews.length}件、itemCodeと理由コードのみ)`, ``);
        mdLines.push(`| itemCode | 除外理由 |`, `|---|---|`);
        for (const r of excludedReviews) mdLines.push(`| ${r.itemCode} | ${r.exclusionReasons.join(",") || "(なし)"} |`);
      }
      mdLines.push(``);
    }
    await writeFile(`${outDir}publication-review.md`, mdLines.join("\n") + "\n", "utf-8");

    await writeFile(
      `${outDir}run-metadata.json`,
      JSON.stringify(
        {
          runId,
          executedAt: new Date().toISOString(),
          commandMode: "prepare-publication-review",
          status: "completed",
          codeCommit: getCodeCommit(new URL("../../", import.meta.url)),
          sourceRunId: metadata.runId,
          candidateSetHash: metadata.candidateSetHash,
          keywordApprovedFileHash: approvedFileHash,
          reviewHash,
          slugs: pages.map((p) => p.slug),
          candidateCountBySlug: Object.fromEntries(pages.map((p) => [p.slug, p.topCandidates.length])),
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log(`${LOG} 完了(status=completed)`);
    console.log(`${LOG}   sourceRunId: ${metadata.runId}`);
    console.log(`${LOG}   reviewHash: ${reviewHash}`);
    for (const p of pages) console.log(`${LOG}   ${p.slug}: 候補${p.topCandidates.length}件`);
    console.log(`${LOG} 出力先: ${outDir}`);
    console.log(`${LOG}(この資料は内部確認専用です。公開HTMLはまだ生成していません。楽天/Google APIは呼び出していません)`);
  } catch (e) {
    await writeFailureMetadata(outDir, runId, "prepare-publication-review", e);
    console.error(`${LOG} エラー: ${e.message}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`${LOG} 予期しないエラー: ${e.message}`);
  process.exitCode = 1;
});
