// 運用上の採否判定(decisionStatus)と承認・出力・公開ゲート(eligibleForApproval/
// eligibleForExport/eligibleForPublish)。
//
// 【2026-09-05監査対応】これまでscoreBand(PRIORITY/TEST/OBSERVE/REJECT)だけを見て
// 「優先候補」を判断していたため、businessValidated=falseのfixtureデータでも
// 「優先候補13件」のように実運用可能な候補であるかのような表示になっていた。
// このモジュールは、businessValidatedを承認ゲートとして強制する。
// businessValidated=falseの候補は、scoreBandに関わらず常に:
//   - decisionStatus = 'UNVALIDATED'
//   - eligibleForApproval = false
//   - eligibleForExport = false
//   - eligibleForPublish = false
// になる。

/** @typedef {'PRIORITY'|'TEST'|'OBSERVE'|'REJECT'} ScoreBand */
/** @typedef {ScoreBand|'UNVALIDATED'} DecisionStatus */

/**
 * @param {{
 *   businessValidated: boolean,
 *   scoreBand: ScoreBand,
 *   intent: string,
 *   eligibleRakutenCount: number,
 *   bestProductQualityScore: number,
 * }} params
 * @returns {{
 *   decisionStatus: DecisionStatus,
 *   eligibleForApproval: boolean,
 *   eligibleForExport: boolean,
 *   eligibleForPublish: boolean,
 *   validationFailureReasons: string[],
 * }}
 */
export function evaluateDecision(params) {
  const { businessValidated, scoreBand, intent, eligibleRakutenCount, bestProductQualityScore } = params;

  if (!businessValidated) {
    return {
      decisionStatus: "UNVALIDATED",
      eligibleForApproval: false,
      eligibleForExport: false,
      eligibleForPublish: false,
      validationFailureReasons: [
        "BUSINESS_DATA_NOT_VALIDATED",
        `スコア上はscoreBand=${scoreBand}だが、businessValidated=falseのため実運用上は未検証(UNVALIDATED)として扱う`,
      ],
    };
  }

  // ここに到達するのはbusinessValidated=trueの場合のみ。
  // scoreBand自体がREJECTなら、承認・出力の対象にはしない(データは実データだが優先度が低い)。
  const meetsOperationalCriteria =
    scoreBand !== "REJECT" &&
    intent !== "MEDICAL_REVIEW_REQUIRED" &&
    eligibleRakutenCount > 0 &&
    bestProductQualityScore > 0;

  const reasons = [];
  if (scoreBand === "REJECT") reasons.push("scoreBandがREJECTのため承認対象外");
  if (intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("医療関連のため自動承認・自動公開禁止");
  if (eligibleRakutenCount <= 0) reasons.push("楽天商品照合結果にELIGIBLEな商品が無い");
  if (bestProductQualityScore <= 0) reasons.push("Quality Score未計算");

  return {
    decisionStatus: scoreBand, // businessValidated=trueなのでscoreBandをそのまま実運用判定として使う
    eligibleForApproval: meetsOperationalCriteria,
    eligibleForExport: meetsOperationalCriteria, // 実際の出力(export-approved)には別途、承認ファイルでの人間承認が必要
    // Phase 3(既存ページ生成への接続)が未実装のため、businessValidated=trueでも
    // 現時点では常にfalse。Phase 3実装後にこの値の意味が変わる。
    eligibleForPublish: false,
    validationFailureReasons: reasons,
  };
}
