// 運用上の採否判定(decisionStatus)と、人間による承認・出力・公開のための対象化ゲート
// (eligibleForApproval/eligibleForExport/eligibleForPublish)。
//
// 【重要】eligibleForApproval等は「自動で承認・出力・掲載される」という意味ではない。
// 意味は以下の通り:
//   - eligibleForApproval: 人間が承認する対象にできる候補かどうか(承認候補)。
//     人間が作成した承認ファイル(approved-file)に明示的に含めない限り、
//     この値がtrueであっても何も出力・掲載されない。
//   - eligibleForExport: keywords:export-approved で出力され得るかどうか。実際の出力には
//     別途、承認ファイルでの人間の明示的な承認が必須(承認ファイルが無ければ
//     export-approvedはエラー終了し、旧keywords:publishシムも同じ制限を受ける)。
//   - eligibleForPublish: 既存サイトへの掲載対象になり得るか。Phase 3(既存ページ生成への
//     接続)は未実装のため、この値は常にfalse。
// このモジュール自身も、既存サイト生成(generate-site.js)・日次GitHub Actions
// (.github/workflows/daily-pipeline.yml)からは一切呼び出されていない。
//
// 【2026-09-05 マージ前最終監査(2周目)対応】scoreBandとdecisionStatusを完全に分離した。
// scoreBandは需要・購入意図・トレンド等から算出したスコア帯であり、楽天商品供給の
// 有無によって書き換えない(このモジュールはscoreBandを読むだけで、一切上書きしない)。
// 以前は、楽天照合が成功(rakutenLookupStatus=SUCCESS)しさえすれば、
// rakutenSupplyStatus(商品供給の有無)を問わずdecisionStatus=scoreBandをそのまま
// 採用していたため、楽天商品が0件(NO_MATCH)や1〜2件(INSUFFICIENT)の候補でも
// スコアが高ければdecisionStatus=PRIORITYになり得るという設計上の矛盾があった。
// 今回、rakutenSupplyStatusが"ELIGIBLE"(最低3件以上)である場合に限りscoreBandを
// decisionStatusへ採用するように変更し、NO_MATCH/INSUFFICIENTには専用の
// decisionStatus(SUPPLY_NO_MATCH/SUPPLY_INSUFFICIENT)を割り当てた。
//
// 判定の優先順位(上から順に、最初に該当したものがdecisionStatusになる):
//   1. businessValidated=false             → UNVALIDATED
//   2. safetyStatus=MEDICAL_REVIEW_REQUIRED → MEDICAL_REVIEW_REQUIRED
//   3. safetyStatus=HEALTH_REVIEW_REQUIRED  → HEALTH_REVIEW_REQUIRED
//   4. queryQualityStatus=MALFORMED         → MALFORMED_KEYWORD
//      queryQualityStatus=REVIEW_REQUIRED   → QUERY_REVIEW_REQUIRED
//   5. rakutenLookupStatus=NOT_RUN          → SUPPLY_NOT_EVALUATED
//   6. rakutenLookupStatus=API_ERROR        → SUPPLY_LOOKUP_ERROR
//   7. rakutenSupplyStatus=NO_MATCH         → SUPPLY_NO_MATCH
//   8. rakutenSupplyStatus=INSUFFICIENT     → SUPPLY_INSUFFICIENT
//   9. rakutenSupplyStatus=ELIGIBLEの場合のみ → scoreBandをそのまま採用
//      (PRIORITY/TEST/OBSERVE/REJECT)
// いずれの場合も、1以外の理由でブロックされた場合は businessValidated の値を
// 書き換えない(需要データの検証結果と運用判定を混同しない)。scoreBandパラメータ
// 自体も、このモジュールは一切書き換えない(呼び出し側のfinal-priority.jsが
// 算出した値をそのまま読むだけ)。

/** @typedef {'PRIORITY'|'TEST'|'OBSERVE'|'REJECT'} ScoreBand */
/** @typedef {'NOT_RUN'|'SUCCESS'|'API_ERROR'} RakutenLookupStatus */
/** @typedef {'NOT_EVALUATED'|'ELIGIBLE'|'INSUFFICIENT'|'NO_MATCH'} RakutenSupplyStatus */
/** @typedef {'SAFE'|'HEALTH_REVIEW_REQUIRED'|'MEDICAL_REVIEW_REQUIRED'} SafetyStatus */
/** @typedef {'VALID'|'REVIEW_REQUIRED'|'MALFORMED'} QueryQualityStatus */
/**
 * @typedef {ScoreBand|'UNVALIDATED'|'MEDICAL_REVIEW_REQUIRED'|'HEALTH_REVIEW_REQUIRED'|
 *   'MALFORMED_KEYWORD'|'QUERY_REVIEW_REQUIRED'|'SUPPLY_NOT_EVALUATED'|'SUPPLY_LOOKUP_ERROR'|
 *   'SUPPLY_NO_MATCH'|'SUPPLY_INSUFFICIENT'} DecisionStatus
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
 *   rakutenSupplyStatus?: RakutenSupplyStatus,
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
    rakutenSupplyStatus = eligibleRakutenCount > 0 ? "INSUFFICIENT" : "NO_MATCH", // 呼び出し側が未指定の場合の保守的なデフォルト
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

  // 2〜3. 安全ゲート(医療 > 健康訴求の優先順位)。承認候補・出力対象・掲載対象のいずれにもしない
  // (人間が承認ファイルで明示的に承認した場合のみ出力対象になり得るが、医療・健康訴求は
  // その承認候補にすらしない、という意味)。
  if (safetyStatus === "MEDICAL_REVIEW_REQUIRED") {
    return blocked("MEDICAL_REVIEW_REQUIRED", ["MEDICAL_REVIEW_REQUIRED", "医療関連のため承認候補・出力対象・掲載対象のいずれにもしない"]);
  }
  if (safetyStatus === "HEALTH_REVIEW_REQUIRED") {
    return blocked("HEALTH_REVIEW_REQUIRED", ["HEALTH_REVIEW_REQUIRED", "健康訴求のため承認候補・出力対象・掲載対象のいずれにもしない"]);
  }

  // 4. 検索語品質ゲート
  if (queryQualityStatus === "MALFORMED") {
    return blocked("MALFORMED_KEYWORD", ["MALFORMED_KEYWORD", "検索語として意味を成さないため承認候補・出力対象・掲載対象のいずれにもしない"]);
  }
  if (queryQualityStatus === "REVIEW_REQUIRED") {
    return blocked("QUERY_REVIEW_REQUIRED", ["QUERY_REVIEW_REQUIRED", "検索語の人間による確認が必要なため承認候補・出力対象・掲載対象を保留する"]);
  }

  // 5〜6. 楽天照合そのものが実行できていない場合(businessValidatedは変更しない)
  if (rakutenLookupStatus === "NOT_RUN") {
    return blocked("SUPPLY_NOT_EVALUATED", ["SUPPLY_NOT_EVALUATED", "楽天へ渡すクエリが無効、または安全ゲート等により照合を実行していないため供給状況を評価できない"]);
  }
  if (rakutenLookupStatus === "API_ERROR") {
    return blocked("SUPPLY_LOOKUP_ERROR", ["RAKUTEN_LOOKUP_ERROR", "楽天API照合が失敗したため供給状況を評価できない(需要データの検証結果とは独立)"]);
  }

  // 7〜8. 楽天商品供給ゲート。ここに到達するのはrakutenLookupStatus=SUCCESSの場合のみ。
  // scoreBandがどれだけ高くても、楽天商品供給が不十分ならdecisionStatusをscoreBandに
  // しない(=PRIORITY等の実運用上の採否ラベルを名乗らせない)。scoreBand自体は
  // 呼び出し元から渡された値をそのまま検証・報告用に保持する(このモジュールは書き換えない)。
  if (rakutenSupplyStatus === "NO_MATCH") {
    return blocked("SUPPLY_NO_MATCH", [
      "SUPPLY_NO_MATCH",
      `scoreBand=${scoreBand}でも楽天ELIGIBLE商品が0件のため承認候補・出力対象・掲載対象のいずれにもしない`,
    ]);
  }
  if (rakutenSupplyStatus === "INSUFFICIENT") {
    return blocked("SUPPLY_INSUFFICIENT", [
      "SUPPLY_INSUFFICIENT",
      `scoreBand=${scoreBand}でも楽天ELIGIBLE商品が最低基準(3件)未満のため承認候補・出力対象・掲載対象のいずれにもしない`,
    ]);
  }
  if (rakutenSupplyStatus !== "ELIGIBLE") {
    // NOT_EVALUATEDが想定外にここへ到達した場合の保守的なフォールバック
    // (rakutenLookupStatus=SUCCESSならpipeline.js側で必ずELIGIBLE/INSUFFICIENT/NO_MATCH
    // のいずれかに確定するはずだが、念のため安全側に倒す)。
    return blocked("SUPPLY_NOT_EVALUATED", ["SUPPLY_NOT_EVALUATED", `rakutenSupplyStatus=${rakutenSupplyStatus}のため供給状況を評価できない`]);
  }

  // 9. rakutenSupplyStatus=ELIGIBLE(最低3件以上のELIGIBLE商品)の場合のみ、scoreBandを
  //    そのままdecisionStatusとして採用する。
  const meetsOperationalCriteria =
    scoreBand !== "REJECT" &&
    intent !== "MEDICAL_REVIEW_REQUIRED" &&
    eligibleRakutenCount > 0 &&
    bestProductQualityScore > 0;

  const reasons = [];
  if (scoreBand === "REJECT") reasons.push("scoreBandがREJECTのため承認対象外");
  if (intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("医療関連のため承認候補にしない");
  if (bestProductQualityScore <= 0) reasons.push("Quality Score未計算");

  return {
    decisionStatus: scoreBand, // rakutenSupplyStatus=ELIGIBLEかつbusinessValidated=trueなのでscoreBandをそのまま実運用判定として使う
    eligibleForApproval: meetsOperationalCriteria,
    eligibleForExport: meetsOperationalCriteria, // 実際の出力(export-approved)には別途、承認ファイルでの人間承認が必要
    // Phase 3(既存ページ生成への接続)が未実装のため、businessValidated=trueでも
    // 現時点では常にfalse。Phase 3実装後にこの値の意味が変わる。
    eligibleForPublish: false,
    validationFailureReasons: reasons,
  };
}
