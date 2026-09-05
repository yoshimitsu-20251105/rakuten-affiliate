// 運用上の採否判定(decisionStatus)と承認・出力・公開ゲート(eligibleForApproval/
// eligibleForExport/eligibleForPublish)。
//
// 【2026-09-04監査対応】businessValidatedを承認ゲートとして強制する。
// businessValidated=falseの候補は、scoreBandに関わらず常に:
//   - decisionStatus = 'UNVALIDATED'
//   - eligibleForApproval = false
//   - eligibleForExport = false
//   - eligibleForPublish = false
// になる。
//
// 【2026-09-05 GKP実データ監査対応】需要データの検証(businessValidated)・楽天照合の
// 実行結果(rakutenLookupStatus/rakutenSupplyStatus)・安全性(safetyStatus)・
// 検索語品質(queryQualityStatus)を、それぞれ独立した状態として分離した。
// 特に重要な変更点: 楽天APIが失敗しても、需要データ自体が検証済みなら
// businessValidated=trueを維持する(以前はAPI失敗時に無条件でfalseへ
// 上書きしていたが、これは「需要データ未検証」と「楽天照合の失敗」を混同していた)。
//
// 判定の優先順位(上から順に、最初に該当したものがdecisionStatusになる):
//   1. businessValidated=false            → UNVALIDATED
//   2. safetyStatus=MEDICAL_REVIEW_REQUIRED → MEDICAL_REVIEW_REQUIRED
//   3. safetyStatus=HEALTH_REVIEW_REQUIRED  → HEALTH_REVIEW_REQUIRED
//   4. queryQualityStatus=MALFORMED         → MALFORMED_KEYWORD
//   5. queryQualityStatus=REVIEW_REQUIRED   → QUERY_REVIEW_REQUIRED
//   6. rakutenLookupStatus=API_ERROR        → SUPPLY_LOOKUP_ERROR
//   7. rakutenLookupStatus=NOT_RUN(無効クエリ等) → INVALID_RAKUTEN_QUERY
//   8. 上記いずれにも該当しない場合          → scoreBandをそのまま採用
// いずれの場合も、1以外の理由でブロックされた場合は businessValidated の値を
// 書き換えない(需要データの検証結果と運用判定を混同しない)。

/** @typedef {'PRIORITY'|'TEST'|'OBSERVE'|'REJECT'} ScoreBand */
/** @typedef {'NOT_RUN'|'SUCCESS'|'API_ERROR'} RakutenLookupStatus */
/** @typedef {'NOT_EVALUATED'|'ELIGIBLE'|'INSUFFICIENT'|'NO_MATCH'} RakutenSupplyStatus */
/** @typedef {'SAFE'|'HEALTH_REVIEW_REQUIRED'|'MEDICAL_REVIEW_REQUIRED'} SafetyStatus */
/** @typedef {'VALID'|'REVIEW_REQUIRED'|'MALFORMED'} QueryQualityStatus */
/**
 * @typedef {ScoreBand|'UNVALIDATED'|'MEDICAL_REVIEW_REQUIRED'|'HEALTH_REVIEW_REQUIRED'|
 *   'MALFORMED_KEYWORD'|'QUERY_REVIEW_REQUIRED'|'SUPPLY_LOOKUP_ERROR'|'INVALID_RAKUTEN_QUERY'} DecisionStatus
 */

/**
 * @param {{
 *   businessValidated: boolean,
 *   scoreBand: ScoreBand,
 *   intent: string,
 *   eligibleRakutenCount: number,
 *   bestProductQualityScore: number,
 *   safetyStatus?: SafetyStatus,
 *   queryQualityStatus?: QueryQualityStatus,
 *   rakutenLookupStatus?: RakutenLookupStatus,
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
  const {
    businessValidated,
    scoreBand,
    intent,
    eligibleRakutenCount,
    bestProductQualityScore,
    safetyStatus = "SAFE",
    queryQualityStatus = "VALID",
    rakutenLookupStatus = "SUCCESS",
  } = params;

  const blocked = (decisionStatus, reasons) => ({
    decisionStatus,
    eligibleForApproval: false,
    eligibleForExport: false,
    eligibleForPublish: false,
    validationFailureReasons: reasons,
  });

  // 1. businessValidated最優先(既存の承認ゲート、2026-09-04対応分を維持)
  if (!businessValidated) {
    return blocked("UNVALIDATED", [
      "BUSINESS_DATA_NOT_VALIDATED",
      `スコア上はscoreBand=${scoreBand}だが、businessValidated=falseのため実運用上は未検証(UNVALIDATED)として扱う`,
    ]);
  }

  // 2〜3. 安全ゲート(医療 > 健康訴求の優先順位)
  if (safetyStatus === "MEDICAL_REVIEW_REQUIRED") {
    return blocked("MEDICAL_REVIEW_REQUIRED", ["MEDICAL_REVIEW_REQUIRED", "医療関連のため自動承認・自動出力・自動掲載を禁止"]);
  }
  if (safetyStatus === "HEALTH_REVIEW_REQUIRED") {
    return blocked("HEALTH_REVIEW_REQUIRED", ["HEALTH_REVIEW_REQUIRED", "健康訴求のため自動承認・自動出力・自動掲載を禁止"]);
  }

  // 4〜5. 検索語品質ゲート
  if (queryQualityStatus === "MALFORMED") {
    return blocked("MALFORMED_KEYWORD", ["MALFORMED_KEYWORD", "検索語として意味を成さないため自動承認・自動出力・自動掲載を禁止"]);
  }
  if (queryQualityStatus === "REVIEW_REQUIRED") {
    return blocked("QUERY_REVIEW_REQUIRED", ["QUERY_REVIEW_REQUIRED", "検索語の人間による確認が必要なため自動承認・自動出力・自動掲載を保留"]);
  }

  // 6〜7. 楽天照合の実行結果ゲート(businessValidatedは変更しない)
  if (rakutenLookupStatus === "API_ERROR") {
    return blocked("SUPPLY_LOOKUP_ERROR", ["RAKUTEN_LOOKUP_ERROR", "楽天API照合が失敗したため供給状況を評価できない(需要データの検証結果とは独立)"]);
  }
  if (rakutenLookupStatus === "NOT_RUN") {
    return blocked("INVALID_RAKUTEN_QUERY", ["INVALID_RAKUTEN_QUERY", "楽天へ渡すクエリが無効(空/短すぎる)なため照合を実行していない"]);
  }

  // 8. ここに到達するのは safetyStatus=SAFE, queryQualityStatus=VALID,
  //    rakutenLookupStatus=SUCCESS(またはデフォルトのSUCCESS扱い)の場合のみ。
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
