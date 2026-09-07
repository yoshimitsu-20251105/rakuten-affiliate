// Phase 3A(非公開下書きページ生成)専用: 表示商品単位の安全ゲート(2026-09-07 PR#5監査対応)。
//
// 【背景】これまでキーワード単位のsafetyStatus(safety.js)だけを見ており、
// 楽天の販売者(seller)が実際に書いたitemName/catchcopyの文言そのものは検査して
// いなかった。販売者の商品名・キャッチコピーには、医療・健康効果を訴求する表現が
// 含まれている可能性があり、キーワード自体が安全(SAFE)でも、個別商品の文言が
// 安全とは限らない。既存のclassifySafety()(医療・健康語彙リスト)をそのまま再利用し、
// 判定ロジックを二重実装しない。

import { classifySafety } from "./safety.js";

/**
 * @param {{ itemCode: string, itemName?: string, catchcopy?: string }} item
 * @param {{ medicalTerms?: string[], healthTerms?: string[] }} config
 * @returns {{ safe: boolean, reasonCode: string|null }} reasonCodeはseller文言を含まない
 *   (「MEDICAL_REVIEW_REQUIRED」「HEALTH_REVIEW_REQUIRED」のいずれか、安全ならnull)
 */
export function classifyItemSafety(item, config) {
  const text = `${item.itemName ?? ""} ${item.catchcopy ?? ""}`;
  const { safetyStatus } = classifySafety(text, config);
  if (safetyStatus === "SAFE") return { safe: true, reasonCode: null };
  return { safe: false, reasonCode: safetyStatus };
}

/**
 * 商品配列を安全な商品と除外商品に振り分ける。
 * @param {Array<{ itemCode: string, itemName?: string, catchcopy?: string }>} items
 * @param {{ medicalTerms?: string[], healthTerms?: string[] }} config
 * @returns {{
 *   safeItems: Array<any>,
 *   excludedUnsafeItems: Array<{ itemCode: string, reasonCode: string }>,
 * }}
 */
export function filterSafeItems(items, config) {
  const safeItems = [];
  const excludedUnsafeItems = [];
  for (const item of items) {
    const { safe, reasonCode } = classifyItemSafety(item, config);
    if (safe) safeItems.push(item);
    else excludedUnsafeItems.push({ itemCode: item.itemCode, reasonCode });
  }
  return { safeItems, excludedUnsafeItems };
}
