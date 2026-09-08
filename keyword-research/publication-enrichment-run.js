// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 限定的な楽天商品補完の
// オーケストレーション層(2026-09-07対応)。CLI(cli/enrich-publication-products.js)から
// 呼び出しの組み立て(引数解釈・環境変数チェック・ファイルI/O)を分離し、
// テストでは実際のsearchRakutenItemsLiveの代わりにmockのsearchFnを注入できるようにする
// (このモジュール自身は楽天APIを直接呼び出さない。呼び出し関数は呼び出し元から注入される)。
//
// 【重要】1キーワードにつき楽天商品検索は1回だけ(論理検索回数は承認ページ数が上限)。
// 承認済みitemCodeが最新の検索結果に見つからない場合はその商品を掲載しない。
// 結果、ページの有効商品が3件未満になればページ全体を拒否する。

import { loadSourceRun } from "./pilot-draft-source-run.js";
import { loadPublicationApprovalFile } from "./publication-approval.js";
import { sanitizeEnrichedItem } from "./publication-enrichment.js";

const MIN_PRODUCTS_PER_PAGE = 3;

/**
 * @param {{
 *   sourceRunDir: string,
 *   publicationApprovedFilePath: string,
 *   searchFn: (query: string) => Promise<{ items: any[], count: number, source: string }>,
 * }} params
 * @returns {Promise<{
 *   ok: boolean, errors: string[],
 *   sourceRunId?: string, candidateSetHash?: string, publicationApprovedFileHash?: string,
 *   pages?: Array<{ slug: string, items: any[] }>,
 *   logicalRakutenQueryCount: number, apiErrorCount: number,
 * }>}
 */
export async function runPublicationEnrichment({ sourceRunDir, publicationApprovedFilePath, searchFn }) {
  let logicalRakutenQueryCount = 0;
  let apiErrorCount = 0;

  const { valid: approvalValid, approval, approvedFileHash, errors: approvalErrors } = await loadPublicationApprovalFile(publicationApprovedFilePath);
  if (!approvalValid) {
    return { ok: false, errors: approvalErrors.map((e) => `[商品公開承認ファイル] ${e}`), logicalRakutenQueryCount, apiErrorCount };
  }

  const { valid: sourceRunValid, errors: sourceRunErrors, metadata, candidatesByKeyword } = await loadSourceRun(sourceRunDir);
  if (!sourceRunValid) {
    return { ok: false, errors: sourceRunErrors.map((e) => `[source run] ${e}`), logicalRakutenQueryCount, apiErrorCount, publicationApprovedFileHash: approvedFileHash };
  }

  const errors = [];
  if (approval.sourceRunId !== metadata.runId) {
    errors.push(`商品公開承認ファイルのsourceRunId「${approval.sourceRunId}」がsource runの実際のrunId「${metadata.runId}」と一致しません`);
  }
  if (approval.candidateSetHash !== metadata.candidateSetHash) {
    errors.push(`商品公開承認ファイルのcandidateSetHash「${approval.candidateSetHash}」がsource runの実際のcandidateSetHashと一致しません`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, logicalRakutenQueryCount, apiErrorCount, sourceRunId: metadata.runId, candidateSetHash: metadata.candidateSetHash, publicationApprovedFileHash: approvedFileHash };
  }

  const resultPages = [];
  for (const page of approval.pages) {
    const candidate = candidatesByKeyword.get(page.normalizedKeyword);
    if (!candidate) {
      errors.push(`normalizedKeyword「${page.normalizedKeyword}」がsource run内に見つかりません`);
      continue;
    }

    const approvedItemCodes = page.products.map((p) => p.itemCode);

    let searchResult;
    logicalRakutenQueryCount += 1;
    try {
      searchResult = await searchFn(candidate.rakutenQuery);
    } catch (e) {
      apiErrorCount += 1;
      errors.push(`「${page.normalizedKeyword}」の楽天商品検索でAPIエラー: ${e.message}`);
      continue;
    }
    if (searchResult.source !== "live") {
      errors.push(`「${page.normalizedKeyword}」の検索結果がlive以外です(fixture混入は許可しません、source=${searchResult.source})`);
      continue;
    }

    const liveItemsByCode = new Map(searchResult.items.map((it) => [it.itemCode, it]));
    const fetchedAt = new Date().toISOString();
    const pageItems = [];
    const pageErrors = [];
    for (const itemCode of approvedItemCodes) {
      const liveItem = liveItemsByCode.get(itemCode);
      if (!liveItem) {
        pageErrors.push(`承認済みitemCode「${itemCode}」が最新の楽天検索結果に見つからないため掲載しません`);
        continue;
      }
      const { ok, item, errors: itemErrors } = sanitizeEnrichedItem(liveItem, {
        sourceRunId: metadata.runId,
        publicationApprovedFileHash: approvedFileHash,
        fetchedAt,
      });
      if (!ok) {
        pageErrors.push(`itemCode「${itemCode}」: ${itemErrors.join(" / ")}`);
        continue;
      }
      pageItems.push(item);
    }

    if (pageItems.length < MIN_PRODUCTS_PER_PAGE) {
      errors.push(
        `「${page.slug}」: 楽天最新結果との照合後、有効商品が${pageItems.length}件となり最低基準(${MIN_PRODUCTS_PER_PAGE}件)未満です` +
          (pageErrors.length > 0 ? `(${pageErrors.join(" / ")})` : "")
      );
      continue;
    }

    resultPages.push({ slug: page.slug, normalizedKeyword: page.normalizedKeyword, items: pageItems, itemIssues: pageErrors });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      logicalRakutenQueryCount,
      apiErrorCount,
      sourceRunId: metadata.runId,
      candidateSetHash: metadata.candidateSetHash,
      publicationApprovedFileHash: approvedFileHash,
    };
  }

  return {
    ok: true,
    errors: [],
    pages: resultPages,
    logicalRakutenQueryCount,
    apiErrorCount,
    sourceRunId: metadata.runId,
    candidateSetHash: metadata.candidateSetHash,
    publicationApprovedFileHash: approvedFileHash,
  };
}
