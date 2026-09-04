// 非公開ドライランレポート生成(12章)。summary.md + 5種のCSVを出力する。
// dry-runでは公開ページ・本番状態・承認状態を一切変更しない。ここは出力のみを行う。

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

  const priorityCount = candidates.filter((c) => c.adoption === "PRIORITY").length;
  const testCount = candidates.filter((c) => c.adoption === "TEST").length;
  const observeCount = candidates.filter((c) => c.adoption === "OBSERVE").length;
  const rejectCount = candidates.filter((c) => c.adoption === "REJECT").length;
  const medicalExcluded = candidates.filter((c) => c.intent === "MEDICAL_REVIEW_REQUIRED").length;
  const rakutenMatchedCount = candidates.filter((c) => c.rakuten.eligibleCount > 0).length;
  const needsReview = candidates.flatMap((c) => (c.rakuten.matches ?? []).filter((m) => m.status === "NEEDS_MANUAL_REVIEW"));
  const rejectedMatches = candidates.flatMap((c) => (c.rakuten.matches ?? []).filter((m) => m.status === "REJECTED"));
  const apiFallbacks = sourceMetas.filter((m) => m.fallbackUsed || !m.configured);
  const publishTargetCount = candidates.filter((c) => (c.publishBlockReasons ?? []).length === 0).length;
  const businessValidatedCount = candidates.filter((c) => c.webKeywordScore?.businessValidated).length;
  const fixtureBackedCount = candidates.filter((c) => c.webKeywordScore && !c.webKeywordScore.businessValidated).length;

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
    `   重複統合数: ${candidates.filter((c) => c.variantCount > 1).length}件(語順違い等をcanonicalKeywordへ統合)`,
    `7. 採用区分: 優先候補=${priorityCount} / テスト候補=${testCount} / 継続観測=${observeCount} / 除外=${rejectCount}`,
    `8. 楽天商品一致数(ELIGIBLE≥1件のキーワード): ${rakutenMatchedCount}件`,
    `9. 手動確認件数: ${needsReview.length}件(NEEDS_MANUAL_REVIEW、理由はneeds-review.csv参照)`,
    `10. 医療関連除外数: ${medicalExcluded}件(MEDICAL_REVIEW_REQUIRED、自動公開禁止)`,
    `11. API失敗・欠損・フォールバック: ${apiFallbacks.length}件`,
    ...apiFallbacks.map((m) => `   - ${m.source}: ${m.note}`),
    `12. 公開対象件数(承認ゲート前の機械的な要件充足数、実際の公開にはkeywords:export-approvedでの人間承認が別途必要。旧keywords:publishは非推奨エイリアス): ${publishTargetCount}件`,
    `13. 【重要】これはdry-runのため、公開ページ・本番状態(articles-data.json/selected-products.json等)・承認状態の変更、commit、pushは一切行っていません。`,
    `14. 【重要・市場検証区分】businessValidated=true(実データで市場需要を検証済み): ${businessValidatedCount}件 / businessValidated=false(fixtureまたはデータ欠損があり実際の市場需要を示すものではない): ${fixtureBackedCount}件。fixture由来のスコアを実需要として扱わないこと(keyword-scores.csvのdataSource列を参照)。`,
    ``,
  ];
  await writeFile(`${runInfo.outDir}/summary.md`, summaryLines.join("\n"), "utf-8");

  const candidateRows = candidates.map((c) => ({
    canonicalKeyword: c.canonicalKeyword,
    aliases: c.aliases.join(" | "),
    cluster: c.cluster.clusterLabel ?? "",
    intent: c.intent,
    variantCount: c.variantCount,
    mergeReason: c.mergeReason,
    monthlySearches: c.observation.monthlySearches ?? "",
    competitionLevel: c.observation.competitionLevel ?? "",
    trendIndex: c.observation.trendIndex ?? "",
    lowTopOfPageBid_monetizationOnly: c.observation.lowTopOfPageBid ?? "",
    highTopOfPageBid_monetizationOnly: c.observation.highTopOfPageBid ?? "",
  }));
  await writeFile(
    `${runInfo.outDir}/keyword-candidates.csv`,
    toCsv(Object.keys(candidateRows[0] ?? { canonicalKeyword: "" }), candidateRows),
    "utf-8"
  );

  const scoreRows = candidates
    .filter((c) => c.webKeywordScore)
    .map((c) => ({
      canonicalKeyword: c.canonicalKeyword,
      demand: c.webKeywordScore.demand,
      purchaseIntent: c.webKeywordScore.purchaseIntent,
      adsCompetitionGap_notSeoCompetition: c.webKeywordScore.adsCompetitionGap,
      trendAndStability: c.webKeywordScore.trendAndStability,
      rakutenSupplyFit: c.webKeywordScore.rakutenSupplyFit,
      clusterFit: c.webKeywordScore.clusterFit,
      webKeywordScoreTotal: c.webKeywordScore.total,
      confidence: c.webKeywordScore.confidence,
      businessValidated: c.webKeywordScore.businessValidated,
      dataSource: c.webKeywordScore.dataSource,
      bestProductQualityScore: c.bestProductQualityScore,
      finalPriority: c.finalPriority,
      adoption: c.adoption,
      reasons: c.webKeywordScore.reasons.join(" / "),
    }));
  await writeFile(
    `${runInfo.outDir}/keyword-scores.csv`,
    toCsv(Object.keys(scoreRows[0] ?? { canonicalKeyword: "" }), scoreRows),
    "utf-8"
  );

  const matchRows = candidates.flatMap((c) =>
    (c.rakuten.matches ?? []).map((m) => ({
      canonicalKeyword: c.canonicalKeyword,
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
    toCsv(Object.keys(matchRows[0] ?? { canonicalKeyword: "" }), matchRows),
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
      .filter((c) => c.adoption === "REJECT")
      .map((c) => ({
        canonicalKeyword: c.canonicalKeyword,
        itemCode: "",
        reason: (c.publishBlockReasons ?? []).join(" / ") || `FinalPriorityが除外しきい値未満(${c.finalPriority}点)`,
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
    counts: { priorityCount, testCount, observeCount, rejectCount, medicalExcluded, publishTargetCount },
  };
}
