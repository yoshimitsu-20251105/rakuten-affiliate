// Phase 3A(非公開下書きページ生成)専用: 表示商品単位の関連性ゲート(2026-09-07 PR#6対応)。
//
// 【背景】2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、犬用おやつ
// (ジャーキー、商品名に「キャットフード」「猫」がSEOキーワードとして併記)が
// Quality Score 98で1位表示される誤判定が発生した。rakuten-match.js側の修正
// (product-relevance.js、itemName優先の関連性ゲート)は新しく生成するsource runには
// 効くが、旧source runが旧rakuten-match.jsでELIGIBLEと判定した商品はrakuten-items.json
// にそのまま保存されている。このモジュールは、保存済みの商品データへ同じ
// evaluateProductRelevance()を独立に再適用する多層防御であり、楽天API・source runの
// 再実行なしで機能する(旧runでも新runでも同じ基準で除外できる)。
//
// 【重要】rakuten-items.jsonにはitemCaptionが保存されていない(公開情報のみを保持する
// 設計のため)。itemName優先の判定方式であるため、itemNameによる明確な矛盾検出への
// 影響は無いが、「itemNameでは確認できないがcatchcopy/itemCaptionでは確認できる」
// ケースの一部(itemCaptionのみに根拠がある場合)は、この層ではitemCaption無しで
// 判定される点に注意(rakuten-match.js側では元のitemCaptionを使って判定済み)。

import { evaluateProductRelevance } from "./product-relevance.js";

/**
 * @param {{ itemCode: string, itemName?: string, catchcopy?: string }} item
 * @param {string[]} requiredAttributes
 * @returns {{ relevant: boolean, reasonCodes: string[] }} reasonCodesはitemCodeとの
 *   組み合わせでのみ記録し、seller文言全文は含まない
 */
export function classifyItemRelevance(item, requiredAttributes) {
  const relevance = evaluateProductRelevance({
    requiredAttributes,
    itemName: item.itemName,
    catchcopy: item.catchcopy,
  });
  if (relevance.status === "RELEVANT") return { relevant: true, reasonCodes: [] };
  // REJECTED・REVIEW_REQUIREDのいずれも、Phase 3Aの自動表示対象からは除外する。
  return { relevant: false, reasonCodes: relevance.reasonCodes };
}

/**
 * 商品配列を、関連性が確認できた商品とそれ以外(除外)に振り分ける。
 * @param {Array<{ itemCode: string, itemName?: string, catchcopy?: string }>} items
 * @param {string[]} requiredAttributes
 * @returns {{
 *   relevantItems: Array<any>,
 *   excludedIrrelevantItems: Array<{ itemCode: string, reasonCodes: string[] }>,
 * }}
 */
export function filterRelevantItems(items, requiredAttributes) {
  const relevantItems = [];
  const excludedIrrelevantItems = [];
  for (const item of items) {
    const { relevant, reasonCodes } = classifyItemRelevance(item, requiredAttributes);
    if (relevant) relevantItems.push(item);
    else excludedIrrelevantItems.push({ itemCode: item.itemCode, reasonCodes });
  }
  return { relevantItems, excludedIrrelevantItems };
}
