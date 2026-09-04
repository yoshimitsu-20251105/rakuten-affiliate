// FinalPriority = WebKeywordScore × 0.60 + ProductQualityScore × 0.40 (既定値、config可変)
// 商品価格・成果報酬率・想定報酬額・クーポン等は含めない(MonetizationMetricsとして別掲する)。

/**
 * @param {number} webKeywordScore
 * @param {number} productQualityScore
 * @param {{webKeywordScore:number, productQualityScore:number}} weights
 */
export function computeFinalPriority(webKeywordScore, productQualityScore, weights) {
  return Math.round(webKeywordScore * weights.webKeywordScore + productQualityScore * weights.productQualityScore);
}

/**
 * 【2026-09-05監査対応】この関数が返すのはあくまで「スコア帯(scoreBand)」であり、
 * 実運用上の採否(decisionStatus)ではない。fixture/syntheticなデータでもPRIORITY等の
 * scoreBandは試算として算出してよいが、businessValidated=falseの候補は
 * pipeline.js側でdecisionStatusを強制的にUNVALIDATEDへ倒し、
 * eligibleForApproval/eligibleForExport/eligibleForPublishをすべてfalseにする。
 * scoreBandとdecisionStatusを混同・同一視しないこと。
 *
 * @param {number} finalPriority
 * @param {{priority:number, test:number, observe:number}} thresholds
 * @returns {'PRIORITY'|'TEST'|'OBSERVE'|'REJECT'} scoreBand(simulation/test only)
 */
export function classifyScoreBand(finalPriority, thresholds) {
  if (finalPriority >= thresholds.priority) return "PRIORITY";
  if (finalPriority >= thresholds.test) return "TEST";
  if (finalPriority >= thresholds.observe) return "OBSERVE";
  return "REJECT";
}
