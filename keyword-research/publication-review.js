// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 公開候補商品レビュー資料の生成(2026-09-07対応)。
//
// 保存済みsource run(rakuten-items.json)の商品へ、公開ページ単位の厳格な必須属性
// (publication-attributes.js)・医療健康安全性(safety.js)・商品関連性(product-relevance.js)を
// 再適用し、人間が確認するためのレビュー資料を組み立てる。このモジュール自身は
// 何も自動承認しない(eligibleフラグは「人間が承認を検討できる候補」を示すだけ)。

import { evaluateProductRelevance } from "./product-relevance.js";
import { classifySafety } from "./safety.js";
import { needsFlavorSelectionNote } from "./publication-attributes.js";
import { evaluateShopDiversity, findSameSeriesGroups } from "./shop-diversity.js";

const MAX_REVIEW_CANDIDATES = 10;

/**
 * @param {any} item - source runのeligibleItems内の1商品(itemCode/itemName/catchcopy/itemPrice/
 *   reviewAverage/reviewCount/shopName/qualityScore)
 * @param {string[]} requiredAttributes - 公開ページの必須属性
 * @param {any} safetyConfig - loadConfig()の戻り値
 * @returns {any} 内部レビュー用の1商品エントリ
 */
function reviewOneItem(item, requiredAttributes, safetyConfig) {
  const relevance = evaluateProductRelevance({
    requiredAttributes,
    itemName: item.itemName,
    catchcopy: item.catchcopy,
  });
  const { safetyStatus, reasons: safetyReasonsInternal } = classifySafety(`${item.itemName ?? ""} ${item.catchcopy ?? ""}`, safetyConfig);

  const verifiedAttributes = requiredAttributes.filter((a) => relevance.detectedTitleAttributes.includes(a));
  const missingAttributes = requiredAttributes.filter((a) => !relevance.detectedTitleAttributes.includes(a));

  const exclusionReasons = [];
  if (relevance.status !== "RELEVANT") exclusionReasons.push(...relevance.reasonCodes);
  if (safetyStatus !== "SAFE") exclusionReasons.push(safetyStatus);

  const eligible = relevance.status === "RELEVANT" && safetyStatus === "SAFE";

  return {
    itemCode: item.itemCode,
    itemName: item.itemName ?? "",
    catchcopy: item.catchcopy ?? "",
    itemPrice: item.itemPrice ?? null,
    reviewAverage: item.reviewAverage ?? null,
    reviewCount: item.reviewCount ?? null,
    shopName: item.shopName ?? null,
    qualityScore: item.qualityScore ?? null,
    verifiedAttributes,
    missingAttributes,
    relevanceStatus: relevance.status,
    safetyStatus,
    exclusionReasons,
    needsFlavorSelectionNote: needsFlavorSelectionNote(item.itemName),
    eligible,
    _internalSafetyReasonsDoNotExport: safetyReasonsInternal, // 参考用、CLI側では出力しない
  };
}

/**
 * ページ1件分(1キーワード分)の公開候補レビューを組み立てる。
 * @param {{ candidate: any, requiredAttributes: string[], safetyConfig: any }} params
 * @returns {{
 *   itemReviews: any[],
 *   topCandidates: any[],
 *   diversity: ReturnType<typeof evaluateShopDiversity>,
 *   sameSeriesGroups: Array<Array<{itemCode:string,itemName:string}>>,
 * }}
 */
export function buildPageReview({ candidate, requiredAttributes, safetyConfig }) {
  const itemReviews = (candidate.eligibleItems ?? []).map((item) => reviewOneItem(item, requiredAttributes, safetyConfig));
  const eligibleReviews = itemReviews.filter((r) => r.eligible);
  const topCandidates = [...eligibleReviews].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0)).slice(0, MAX_REVIEW_CANDIDATES);

  const diversityInput = topCandidates.map((r) => ({ itemCode: r.itemCode, shopName: r.shopName }));
  const diversity = evaluateShopDiversity(diversityInput);
  const sameSeriesGroups = findSameSeriesGroups(topCandidates.map((r) => ({ itemCode: r.itemCode, itemName: r.itemName })));

  return { itemReviews, topCandidates, diversity, sameSeriesGroups };
}

export { MAX_REVIEW_CANDIDATES };
