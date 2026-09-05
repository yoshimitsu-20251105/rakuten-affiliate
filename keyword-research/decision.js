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
// 【2026-09-05 マージ前最終監査対応】rakutenSupplyStatus(ELIGIBLE/INSUFFICIENT/
// NO_MATCH/NOT_EVALUATED)を承認候補ゲートに明示的に組み込んだ。以前は
// eligibleRakutenCount > 0 だけを見ていたため、楽天ELIGIBLE商品が1〜2件しかない
// (INSUFFICIENT、ランキングページ化に必要な最低3件に満たない)候補でも、
// 他の条件を満たせばeligibleForApproval=trueになってしまう実データ上のバグが
// あった(実例: 「heka グレイン フリー ドッグフード サーモン」ELIGIBLE1件が
// eligibleForApproval=trueになっていた)。rakutenSupplyStatus==="ELIGIBLE"
// (=最低3件以上のELIGIBLE商品)を必須条件に追加して修正した。
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
//      (ただしrakutenSupplyStatus==="ELIGIBLE"でなければ承認候補にはしない)
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

  // 4〜5. 検索語品質ゲート
  if (queryQualityStatus === "MALFORMED") {
    return blocked("MALFORMED_KEYWORD", ["MALFORMED_KEYWORD", "検索語として意味を成さないため承認候補・出力対象・掲載対象のいずれにもしない"]);
  }
  if (queryQualityStatus === "REVIEW_REQUIRED") {
    return blocked("QUERY_REVIEW_REQUIRED", ["QUERY_REVIEW_REQUIRED", "検索語の人間による確認が必要なため承認候補・出力対象・掲載対象を保留する"]);
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
  //    rakutenSupplyStatus==="ELIGIBLE"(最低3件以上のELIGIBLE商品)を必須条件にする
  //    (2026-09-05マージ前監査で、INSUFFICIENT(1〜2件)でも承認候補になってしまう
  //    実データ上のバグを発見したため追加)。
  const meetsOperationalCriteria =
    scoreBand !== "REJECT" &&
    intent !== "MEDICAL_REVIEW_REQUIRED" &&
    rakutenSupplyStatus === "ELIGIBLE" &&
    eligibleRakutenCount > 0 &&
    bestProductQualityScore > 0;

  const reasons = [];
  if (scoreBand === "REJECT") reasons.push("scoreBandがREJECTのため承認対象外");
  if (intent === "MEDICAL_REVIEW_REQUIRED") reasons.push("医療関連のため承認候補にしない");
  if (rakutenSupplyStatus !== "ELIGIBLE") {
    reasons.push(`rakutenSupplyStatus=${rakutenSupplyStatus}のため承認候補にしない(楽天ELIGIBLE商品が最低基準(3件)未満、または0件)`);
  }
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
