// 非公開ドライランレポート生成(12章)。summary.md + 5種のCSVを出力する。
// dry-runでは公開ページ・本番状態・承認状態を一切変更しない。ここは出力のみを行う。
//
// 【2026-09-05監査対応】scoreBand(スコア上の候補数、simulation/test only)と
// decisionStatus(businessValidatedを通過した実運用候補数)を明確に分離して表示する。
// businessValidated=trueが0件なら、実運用上の優先候補・承認可能候補・出力可能候補は
// すべて0件と表示する(スコア上のPRIORITY件数と混同しない)。
//
// 【2026-09-05 GKP実データ監査対応】需要データ検証(businessValidated)・楽天照合の
// 実行結果(rakutenLookupStatus/rakutenSupplyStatus)・安全性(safetyStatus)・
// 検索語品質(queryQualityStatus)を、それぞれ独立した集計として表示する。
// originalKeyword/normalizedKeyword/rakutenQueryもCSVへ明示する。

import { mkdir, writeFile } from "node:fs/promises";
import { toCsv } from "./csv.js";

/**
 * @param {{ candidates: any[], sourceMetas: any[], config: any }} pipelineResult
 * @param {{ outDir: string, mode: string, runId: string }} runInfo
 */
export async function writeReports(pipelineResult, runInfo) {
  const { candidates, sourceMetas } = pipelineResult;
  await mkdir(runInfo.outDir, { recursive: true });

  const clusterCounts = {};
  for (const c of candidates) {
    const key = c.cluster.clusterLabel ?? "(クラスター外)";
    clusterCounts[key] = (clusterCounts[key] ?? 0) + 1;
  }

  // --- スコア帯(scoreBand): businessValidatedを問わない試算結果(simulation/test only) ---
  const scoreBandPriorityCount = candidates.filter((c) => c.scoreBand === "PRIORITY").length;
  const scoreBandTestCount = candidates.filter((c) => c.scoreBand === "TEST").length;
  const scoreBandObserveCount = candidates.filter((c) => c.scoreBand === "OBSERVE").length;
  const scoreBandRejectCount = candidates.filter((c) => c.scoreBand === "REJECT").length;

  // --- 実運用判定(decisionStatus): businessValidated=trueの候補のみ ---
  const businessValidatedCount = candidates.filter((c) => c.businessValidated === true).length;
  const unvalidatedCount = candidates.filter((c) => c.decisionStatus === "UNVALIDATED").length;
  const operationalPriorityCount = candidates.filter((c) => c.businessValidated && c.decisionStatus === "PRIORITY").length;
  const operationalTestCount = candidates.filter((c) => c.businessValidated && c.decisionStatus === "TEST").length;
  const operationalObserveCount = candidates.filter((c) => c.businessValidated && c.decisionStatus === "OBSERVE").length;
  const eligibleForApprovalCount = candidates.filter((c) => c.eligibleForApproval === true).length;
  const eligibleForExportCount = candidates.filter((c) => c.eligibleForExport === true).length;
  const eligibleForPublishCount = candidates.filter((c) => c.eligibleForPublish === true).length;

  // --- 楽天照合の実行結果(需要データ検証とは独立) ---
  const rakutenSuccessCount = candidates.filter((c) => c.rakutenLookupStatus === "SUCCESS").length;
  const rakutenApiErrorCount = candidates.filter((c) => c.rakutenLookupStatus === "API_ERROR").length;
  const rakutenNotRunCount = candidates.filter((c) => c.rakutenLookupStatus === "NOT_RUN").length;
  const rakutenInsufficientCount = candidates.filter((c) => c.rakutenSupplyStatus === "INSUFFICIENT").length;
  const rakutenNoMatchCount = candidates.filter((c) => c.rakutenSupplyStatus === "NO_MATCH").length;

  // --- 安全ゲート・検索語品質(2026-09-05 GKP実データ監査対応) ---
  const medicalReviewCount = candidates.filter((c) => c.safetyStatus === "MEDICAL_REVIEW_REQUIRED").length;
  const healthReviewCount = candidates.filter((c) => c.safetyStatus === "HEALTH_REVIEW_REQUIRED").length;
  const malformedCount = candidates.filter((c) => c.queryQualityStatus === "MALFORMED").length;
  const queryReviewRequiredCount = candidates.filter((c) => c.queryQualityStatus === "REVIEW_REQUIRED").length;

  const medicalExcluded = candidates.filter((c) => c.intent === "MEDICAL_REVIEW_REQUIRED").length;
  const rakutenMatchedCount = candidates.filter((c) => c.rakuten.eligibleCount > 0).length;
  const needsReview = candidates.flatMap((c) => (c.rakuten.matches ?? []).filter((m) => m.status === "NEEDS_MANUAL_REVIEW"));
  const rejectedMatches = candidates.flatMap((c) => (c.rakuten.matches ?? []).filter((m) => m.status === "REJECTED"));
  const apiFallbacks = sourceMetas.filter((m) => m.fallbackUsed || !m.configured);

  const summaryLines = [
    `# Webキーワードリサーチ ドライランレポート`,
    ``,
    `1. 実行日時: ${runInfo.runId}`,
    `2. 実行モード: ${runInfo.mode}`,
    `3. 使用データ源:`,
    ...sourceMetas.map((m) => `   - ${m.source}: configured=${m.configured} fallbackUsed=${m.fallbackUsed} — ${m.note}`),
    `4. 対象期間: 実行時点の最新データ(ソースごとのperiodはCSV参照)`,
    `5. クラスター別候補数:`,
    ...Object.entries(clusterCounts).map(([k, v]) => `   - ${k}: ${v}件`),
    `6. 取得件数: ${candidates.reduce((s, c) => s + c.variantCount, 0)}件(観測) → 正規化・重複統合後: ${candidates.length}件`,
    `   重複統合数: ${candidates.filter((c) => c.variantCount > 1).length}件(語順違い等をcanonicalKeywordへ統合。monthlySearchesは合算せず最大値を採用)`,
    `7a. 【スコア帯(scoreBand) — simulation/test only、businessValidatedを問わない試算値】`,
    `    優先候補相当=${scoreBandPriorityCount} / テスト候補相当=${scoreBandTestCount} / 継続観測相当=${scoreBandObserveCount} / 除外相当=${scoreBandRejectCount}`,
    `    ※ここに表示される件数は「スコア計算のテスト結果」であり、fixtureや欠損データでも算出される。実運用可能な候補数ではない。`,
    `7b. 【実運用判定(decisionStatus) — businessValidated=trueの候補のみ】`,
    `    需要データ検証済み件数(businessValidated=true)=${businessValidatedCount}件 / businessValidated=false(UNVALIDATED)=${unvalidatedCount}件`,
    `    実運用上の優先候補=${operationalPriorityCount} / 実運用上のテスト候補=${operationalTestCount} / 実運用上の継続観測=${operationalObserveCount}`,
    `    自動承認可能件数(eligibleForApproval)=${eligibleForApprovalCount} / 出力可能件数(eligibleForExport)=${eligibleForExportCount} / 公開可能件数(eligibleForPublish、Phase3未実装のため常に0)=${eligibleForPublishCount}`,
    businessValidatedCount === 0
      ? `    ⚠ businessValidated=trueが0件のため、実運用上の優先候補・承認可能候補・出力可能候補はすべて0件です(7aのスコア帯とは別物です)。`
      : ``,
    `7c. 【楽天照合の実行結果 — 需要データ検証とは独立(2026-09-05対応)】`,
    `    楽天照合成功件数(rakutenLookupStatus=SUCCESS)=${rakutenSuccessCount} / 楽天APIエラー件数(API_ERROR)=${rakutenApiErrorCount} / 未実行(NOT_RUN、安全ゲート等でスキップ)=${rakutenNotRunCount}`,
    `    楽天商品不足件数(rakutenSupplyStatus=INSUFFICIENT、1〜2件のみ一致)=${rakutenInsufficientCount} / 商品0件(NO_MATCH)=${rakutenNoMatchCount}`,
    `    【重要】楽天APIエラーはbusinessValidatedを変更しない(需要データの検証結果と楽天照合の成否は別の状態として扱う)。`,
    `7d. 【安全ゲート・検索語品質】`,
    `    医療レビュー件数(safetyStatus=MEDICAL_REVIEW_REQUIRED)=${medicalReviewCount} / 健康訴求レビュー件数(HEALTH_REVIEW_REQUIRED)=${healthReviewCount}`,
    `    不自然な検索語件数: MALFORMED=${malformedCount} / REVIEW_REQUIRED(要確認、自動除外はしない)=${queryReviewRequiredCount}`,
    `    医療・健康レビュー対象および不自然な検索語は、businessValidatedの値に関わらず自動承認・自動出力・自動掲載を禁止する。`,
    `8. 楽天商品一致数(ELIGIBLE≥1件のキーワード): ${rakutenMatchedCount}件`,
    `9. 手動確認件数: ${needsReview.length}件(NEEDS_MANUAL_REVIEW、理由はneeds-review.csv参照)`,
    `10. 医療関連除外数(intent=MEDICAL_REVIEW_REQUIRED): ${medicalExcluded}件(safetyStatusベースの医療レビュー件数は7d参照)`,
    `11. API失敗・欠損・フォールバック: ${apiFallbacks.length}件`,
    ...apiFallbacks.map((m) => `   - ${m.source}: ${m.note}`),
    `12. 出力可能件数(eligibleForExport、承認ゲート前の機械的な要件充足数): ${eligibleForExportCount}件。実際の出力にはkeywords:export-approvedでの人間承認と、対象候補のbusinessValidated=trueが必須(旧keywords:publishは非推奨エイリアスで同じ制限がかかる)。`,
    `13. 【重要】これはdry-runのため、公開ページ・本番状態(articles-data.json/selected-products.json等)・承認状態の変更、commit、pushは一切行っていません。`,
    `14. 【重要・市場検証区分】businessValidated=true(実データで市場需要を検証済み): ${businessValidatedCount}件 / businessValidated=false(fixtureまたはデータ欠損があり実際の市場需要を示すものではない): ${candidates.length - businessValidatedCount}件。fixture由来のスコアを実需要・実運用候補として扱わないこと(keyword-scores.csvのbusinessValidated/dataSource/sourceProvider/isSynthetic列を参照)。`,
    ``,
  ].filter((line) => line !== "");
  await writeFile(`${runInfo.outDir}/summary.md`, summaryLines.join("\n"), "utf-8");

  const candidateRows = candidates.map((c) => ({
    originalKeyword: c.originalKeyword,
    normalizedKeyword: c.normalizedKeyword,
    rakutenQuery: c.rakutenQuery ?? "",
    keywordVariants: (c.keywordVariants ?? []).join(" | "),
    cluster: c.cluster.clusterLabel ?? "",
    intent: c.intent,
    safetyStatus: c.safetyStatus,
    queryQualityStatus: c.queryQualityStatus,
    variantCount: c.variantCount,
    mergeReason: c.mergeReason,
    sourceProvider: c.observation.sourceProvider ?? "unknown",
    isSynthetic: c.observation.isSynthetic ?? false,
    periodStart: c.observation.periodStart ?? "",
    periodEnd: c.observation.periodEnd ?? "",
    monthlySearches: c.observation.monthlySearches ?? "",
    searchVolumeVariance: c.observation.searchVolumeVariance ? JSON.stringify(c.observation.searchVolumeVariance) : "",
    competitionLevel: c.observation.competitionLevel ?? "",
    trendIndex: c.observation.trendIndex ?? "",
    lowTopOfPageBid_monetizationOnly: c.observation.lowTopOfPageBid ?? "",
    highTopOfPageBid_monetizationOnly: c.observation.highTopOfPageBid ?? "",
  }));
  await writeFile(
    `${runInfo.outDir}/keyword-candidates.csv`,
    toCsv(Object.keys(candidateRows[0] ?? { originalKeyword: "" }), candidateRows),
    "utf-8"
  );

  const scoreRows = candidates.map((c) => ({
    originalKeyword: c.originalKeyword,
    normalizedKeyword: c.normalizedKeyword,
    rakutenQuery: c.rakutenQuery ?? "",
    businessValidated: c.businessValidated,
    scoreBand_simulationOnly: c.scoreBand,
    decisionStatus: c.decisionStatus,
    safetyStatus: c.safetyStatus,
    queryQualityStatus: c.queryQualityStatus,
    rakutenLookupStatus: c.rakutenLookupStatus,
    rakutenSupplyStatus: c.rakutenSupplyStatus,
    eligibleForApproval: c.eligibleForApproval,
    eligibleForExport: c.eligibleForExport,
    eligibleForPublish: c.eligibleForPublish,
    validationFailureReasons: (c.validationFailureReasons ?? []).join(" / "),
    dataSource: c.webKeywordScore?.dataSource ?? c.observation.source ?? "unknown",
    sourceProvider: c.observation.sourceProvider ?? "unknown",
    isSynthetic: c.observation.isSynthetic ?? false,
    demand: c.webKeywordScore?.demand ?? "",
    purchaseIntent: c.webKeywordScore?.purchaseIntent ?? "",
    adsCompetitionGap_notSeoCompetition: c.webKeywordScore?.adsCompetitionGap ?? "",
    trendAndStability: c.webKeywordScore?.trendAndStability ?? "",
    rakutenSupplyFit: c.webKeywordScore?.rakutenSupplyFit ?? "",
    clusterFit: c.webKeywordScore?.clusterFit ?? "",
    webKeywordScoreTotal: c.webKeywordScore?.total ?? "",
    confidence: c.webKeywordScore?.confidence ?? "",
    bestProductQualityScore: c.bestProductQualityScore,
    finalPriority: c.finalPriority,
    reasons: (c.webKeywordScore?.reasons ?? []).join(" / "),
  }));
  await writeFile(
    `${runInfo.outDir}/keyword-scores.csv`,
    toCsv(Object.keys(scoreRows[0] ?? { originalKeyword: "" }), scoreRows),
    "utf-8"
  );

  const matchRows = candidates.flatMap((c) =>
    (c.rakuten.matches ?? []).map((m) => ({
      originalKeyword: c.originalKeyword,
      normalizedKeyword: c.normalizedKeyword,
      rakutenQuery: c.rakutenQuery ?? "",
      itemCode: m.itemCode,
      status: m.status,
      matchScore: m.matchScore,
      requiredAttributes: m.requiredAttributes.join(" | "),
      matchedAttributes: m.matchedAttributes.join(" | "),
      missingAttributes: m.missingAttributes.join(" | "),
      conflictingAttributes: m.conflictingAttributes.join(" | "),
      dataSource: c.rakuten.searchSource,
      reasons: m.reasons.join(" / "),
    }))
  );
  await writeFile(
    `${runInfo.outDir}/rakuten-matches.csv`,
    toCsv(Object.keys(matchRows[0] ?? { originalKeyword: "" }), matchRows),
    "utf-8"
  );

  const needsReviewRows = needsReview.map((m) => ({
    canonicalKeyword: m.canonicalKeyword,
    itemCode: m.itemCode,
    missingAttributes: m.missingAttributes.join(" | "),
    reasons: m.reasons.join(" / "),
  }));
  await writeFile(
    `${runInfo.outDir}/needs-review.csv`,
    toCsv(Object.keys(needsReviewRows[0] ?? { canonicalKeyword: "" }), needsReviewRows),
    "utf-8"
  );

  const rejectedRows = [
    ...rejectedMatches.map((m) => ({
      canonicalKeyword: m.canonicalKeyword,
      itemCode: m.itemCode,
      reason: m.reasons.join(" / "),
      level: "product",
    })),
    ...candidates
      .filter((c) => !c.eligibleForApproval)
      .map((c) => ({
        canonicalKeyword: c.originalKeyword,
        itemCode: "",
        reason:
          (c.publishBlockReasons ?? []).join(" / ") ||
          `FinalPriorityが除外しきい値未満(${c.finalPriority}点)`,
        level: "keyword",
      })),
  ];
  await writeFile(
    `${runInfo.outDir}/rejected.csv`,
    toCsv(Object.keys(rejectedRows[0] ?? { canonicalKeyword: "" }), rejectedRows),
    "utf-8"
  );

  return {
    summaryPath: `${runInfo.outDir}/summary.md`,
    counts: {
      // 後方互換のためpriorityCount等はscoreBand相当の値を返すが、呼び出し側(CLI)には
      // 実運用件数(operational*)とscoreBand件数を区別してログ表示させる。
      priorityCount: scoreBandPriorityCount,
      testCount: scoreBandTestCount,
      observeCount: scoreBandObserveCount,
      rejectCount: scoreBandRejectCount,
      medicalExcluded,
      businessValidatedCount,
      operationalPriorityCount,
      operationalTestCount,
      operationalObserveCount,
      eligibleForApprovalCount,
      eligibleForExportCount,
      eligibleForPublishCount,
      publishTargetCount: eligibleForExportCount,
      rakutenSuccessCount,
      rakutenApiErrorCount,
      rakutenNotRunCount,
      rakutenInsufficientCount,
      rakutenNoMatchCount,
      medicalReviewCount,
      healthReviewCount,
      malformedCount,
      queryReviewRequiredCount,
    },
  };
}
