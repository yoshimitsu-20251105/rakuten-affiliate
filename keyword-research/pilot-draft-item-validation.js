// Phase 3A(非公開下書きページ生成)専用: 表示商品の数値フィールド型検証(2026-09-07 PR#5監査対応)。
// 不正な数値(NaN・Infinity・範囲外・文字列混入等)をHTMLへそのまま埋め込むと、
// 表示崩れやエスケープ漏れのリスクがあるため、テンプレートへ渡す前にsource run側の
// データ不整合として検出する。

/**
 * @param {any} item
 * @returns {string[]} 検出された問題(空配列なら問題なし)
 */
export function validateItemNumericFields(item) {
  const errors = [];
  const { itemCode, qualityScore, itemPrice, reviewAverage, reviewCount } = item;

  if (!Number.isFinite(qualityScore) || qualityScore < 0 || qualityScore > 100) {
    errors.push(`itemCode「${itemCode}」のqualityScoreが不正です(0〜100の有限数である必要があります)`);
  }
  if (itemPrice !== null && (!Number.isFinite(itemPrice) || itemPrice < 0)) {
    errors.push(`itemCode「${itemCode}」のitemPriceが不正です(nullまたは0以上の有限数である必要があります)`);
  }
  if (reviewAverage !== null && (!Number.isFinite(reviewAverage) || reviewAverage < 0 || reviewAverage > 5)) {
    errors.push(`itemCode「${itemCode}」のreviewAverageが不正です(nullまたは0〜5の有限数である必要があります)`);
  }
  if (reviewCount !== null && (!Number.isInteger(reviewCount) || reviewCount < 0)) {
    errors.push(`itemCode「${itemCode}」のreviewCountが不正です(nullまたは0以上の整数である必要があります)`);
  }
  return errors;
}

/**
 * @param {any[]} items
 * @returns {string[]}
 */
export function validateItemsNumericFields(items) {
  return items.flatMap((item) => validateItemNumericFields(item));
}
