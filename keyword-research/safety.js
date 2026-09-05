// 安全ゲート(2026-09-05 GKP実データ監査対応)。
// SearchIntent(購入意図の分類、intent.js)とは独立した軸として、医療・健康訴求語彙を
// 判定する。既存のintent.js内のMEDICAL_REVIEW_REQUIRED判定はSearchIntentとしての
// 後方互換のため残しているが、実際の承認・出力・公開ゲート(decision.js)は
// このモジュールが返すsafetyStatusを最優先で参照する。
//
// 医療語彙(MEDICAL_REVIEW_REQUIRED)が健康訴求語彙(HEALTH_REVIEW_REQUIRED)より
// 常に優先される。両方とも承認候補・出力対象・掲載対象のいずれにもしない対象であり、
// この2つを区別する目的は「深刻度の違いをレポート上で見分けられるようにする」ため。

/** @typedef {'SAFE'|'HEALTH_REVIEW_REQUIRED'|'MEDICAL_REVIEW_REQUIRED'} SafetyStatus */

/**
 * @param {string} canonicalKeyword
 * @param {{ medicalTerms?: string[], healthTerms?: string[] }} config
 * @returns {{ safetyStatus: SafetyStatus, reasons: string[] }}
 */
export function classifySafety(canonicalKeyword, config) {
  const medicalMatched = (config.medicalTerms ?? []).filter((term) => canonicalKeyword.includes(term));
  if (medicalMatched.length > 0) {
    return {
      safetyStatus: "MEDICAL_REVIEW_REQUIRED",
      reasons: [`医療関連語を検出: ${medicalMatched.join(", ")}(承認候補・出力対象・掲載対象のいずれにもしない)`],
    };
  }

  const healthMatched = (config.healthTerms ?? []).filter((term) => canonicalKeyword.includes(term));
  if (healthMatched.length > 0) {
    return {
      safetyStatus: "HEALTH_REVIEW_REQUIRED",
      reasons: [`健康訴求語を検出: ${healthMatched.join(", ")}(承認候補・出力対象・掲載対象のいずれにもしない)`],
    };
  }

  return { safetyStatus: "SAFE", reasons: [] };
}
