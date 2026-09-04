// FinalPriority計算用に、楽天照合で見つかった商品へ既存Quality Score(lib/quality-score.js)
// を適用するアダプター。既存の計算式・重みは一切変更しない。
//
// repeatSignal(リピート性)の判定は select-products.js の repeatSignalKeywords 判定を
// 参考にした簡易版。select-products.js は実行すると即APIコール・process.exitを伴うため
// モジュールとしてimportできず、ここでは同等のキーワードリストを保持している(この
// 判定はFinalPriorityという補助指標にのみ使われ、既存サイトの表示スコア自体には
// 影響しない)。

import { scoreItem } from "../lib/quality-score.js";

const REPEAT_SIGNAL_KEYWORDS = ["リピート", "定期便", "定期コース", "殿堂入り", "累計", "毎年注文", "何度も", "サブスク"];

function hasRepeatSignal(item) {
  const text = `${item.itemName ?? ""} ${item.catchcopy ?? ""}`;
  return REPEAT_SIGNAL_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * @param {any} item - 楽天商品(itemName, catchcopy, reviewAverage, reviewCount等)
 * @returns {number} 既存Quality Score(0〜100)
 */
export function computeProductQualityScore(item) {
  if (typeof item.reviewAverage !== "number" || typeof item.reviewCount !== "number") {
    return 0;
  }
  return scoreItem({ ...item, repeatSignal: hasRepeatSignal(item) });
}
