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
//
// 【2026-09-05 マージ前最終監査(3周目)対応】異なる実行結果を正しく比較できるように、
// run-metadata.jsonへ再現性情報(candidateSetHash・searchSourceCounts等)を出力する。
// この監査で、.envを読み込まずに楽天照合スクリプトを実行してしまい、実際の楽天APIでは
// なくテスト用fixture(9件のみ)へ静かにフォールバックしていたことに気づかないまま
// 「楽天ELIGIBLE件数が90→47に激減した」と誤認する事故があった。searchSourceCounts
// (live/fixtureの内訳)をレポートへ必ず明示することで、今後この種の誤認を防ぐ。

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { toCsv } from "./csv.js";

function sha256(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * @param {{ candidates: any[], sourceMetas: any[], config: any }} pipelineResult
 * @param {{ outDir: string, mode: string, runId: string, codeCommit?: string, inputFileHash?: string }} runInfo
 */
export async function writeReports(pipelineResult, runInfo) {
  const { candidates, sourceMetas, config } = pipelineResult;
  await mkdir(runInfo.outDir, { recursive: true });

  // --- 再現性情報(2026-09-05 マージ前最終監査(3周目)対応) ---
  const candidateSetHash = sha256(
    candidates.map((c) => c.originalKeyword).sort().join("\n")
  );
  const mappingConfigHash = sha256(JSON.stringify(config ?? {}));
  const searchSourceCounts = {};
  for (const c of candidates) {
    const key = c.rakuten?.searchSource ?? "(未実行)";
    searchSourceCounts[key] = (searchSourceCounts[key] ?? 0) + 1;
  }

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
  // 【2026-09-05 マージ前最終監査(2周目)対応】decisionStatus=PRIORITY/TEST/OBSERVEは、
  // rakutenSupplyStatus=ELIGIBLE(楽天商品供給が十分)の場合にのみ付与されるようdecision.js
  // 側を修正済み(NO_MATCH/INSUFFICIENTはSUPPLY_NO_MATCH/SUPPLY_INSUFFICIENTになる)。
  // その上で「実運用上のPRIORITY件数」は、decisionStatus=PRIORITY かつ
  // eligibleForApproval=true(Quality Score計算済み等の残りの要件も満たす)の件数のみとする。
  const businessValidatedCount = candidates.filter((c) => c.businessValidated === true).length;
  const unvalidatedCount = candidates.filter((c) => c.decisionStatus === "UNVALIDATED").length;
  const eligibleForApprovalCount = candidates.filter((c) => c.eligibleForApproval === true).length;
  const eligibleForExportCount = candidates.filter((c) => c.eligibleForExport === true).length;
  const eligibleForPublishCount = candidates.filter((c) => c.eligibleForPublish === true).length;
  // eligibleForApprovalはPRIORITY/TEST/OBSERVEのいずれの帯でもtrueになり得るため、
  // 「PRIORITY件数」と「承認候補件数」を混同しないよう、帯ごとの内訳も別掲する。
  const approvalCandidateByBand = {
    PRIORITY: candidates.filter((c) => c.eligibleForApproval && c.decisionStatus === "PRIORITY").length,
    TEST: candidates.filter((c) => c.eligibleForApproval && c.decisionStatus === "TEST").length,
    OBSERVE: candidates.filter((c) => c.eligibleForApproval && c.decisionStatus === "OBSERVE").length,
  };
  // 実運用上のPRIORITY件数 = decisionStatus=PRIORITY かつ eligibleForApproval=true の件数だけ
  // (スコア上のPRIORITY件数=scoreBandPriorityCountとは明確に区別する)。
  const operationalPriorityCount = approvalCandidateByBand.PRIORITY;
  const operationalTestCount = approvalCandidateByBand.TEST;
  const operationalObserveCount = approvalCandidateByBand.OBSERVE;
  // 承認済み件数: このdry-runレポートは承認ファイル(approved-file)を一切参照しないため、
  // 「承認候補(eligibleForApproval)」と「承認済み(人間が承認ファイルに含めて
  // keywords:export-approvedを実行した結果)」は常に別物であり、ここでは常に0件を表示する。
  const approvedCount = 0;

  // --- 楽天照合の実行結果(需要データ検証とは独立) ---
  const rakutenSuccessCount = candidates.filter((c) => c.rakutenLookupStatus === "SUCCESS").length;
  const rakutenApiErrorCount = candidates.filter((c) => c.rakutenLookupStatus === "API_ERROR").length;
  const rakutenNotRunCount = candidates.filter((c) => c.rakutenLookupStatus === "NOT_RUN").length;
  const rakutenInsufficientCount = candidates.filter((c) => c.rakutenSupplyStatus === "INSUFFICIENT").length;
  const rakutenNoMatchCount = candidates.filter((c) => c.rakutenSupplyStatus === "NO_MATCH").length;
  // decisionStatusベースの供給不足系件数(rakutenSupplyStatusベースの上記2件と値は一致するはずだが、
  // decision.jsの最終判定結果そのものとして別途明示する)。
  const supplyNoMatchDecisionCount = candidates.filter((c) => c.decisionStatus === "SUPPLY_NO_MATCH").length;
  const supplyInsufficientDecisionCount = candidates.filter((c) => c.decisionStatus === "SUPPLY_INSUFFICIENT").length;
  const supplyNotEvaluatedDecisionCount = candidates.filter((c) => c.decisionStatus === "SUPPLY_NOT_EVALUATED").length;
  const supplyLookupErrorDecisionCount = candidates.filter((c) => c.decisionStatus === "SUPPLY_LOOKUP_ERROR").length;

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
    `3b. 【楽天照合のデータソース内訳(searchSource)】 ${Object.entries(searchSourceCounts).map(([k, v]) => `${k}=${v}件`).join(" / ") || "(該当なし)"}`,
    (searchSourceCounts.fixture ?? 0) > 0
      ? `    ⚠【重要】fixture(テスト用の固定データ、実際の楽天在庫ではない)へのフォールバックが${searchSourceCounts.fixture}件発生しています。RAKUTEN_APP_ID/RAKUTEN_SECRETが未設定(.envを読み込まずに実行した等)の場合にこうなります。この実行結果を実データの楽天照合結果として扱わないでください。`
      : `    fixtureへのフォールバックは0件です(すべて${searchSourceCounts.live ? "live(実際の楽天API)" : "設定された検索関数"}によるデータです)。`,
    `4. 対象期間: 実行時点の最新データ(ソースごとのperiodはCSV参照)`,
    `5. クラスター別候補数:`,
    ...Object.entries(clusterCounts).map(([k, v]) => `   - ${k}: ${v}件`),
    `6. 取得件数: ${candidates.reduce((s, c) => s + c.variantCount, 0)}件(観測) → 正規化・重複統合後: ${candidates.length}件`,
    `   重複統合数: ${candidates.filter((c) => c.variantCount > 1).length}件(語順違い等をcanonicalKeywordへ統合。monthlySearchesは合算せず最大値を採用)`,
    `7a. 【スコア帯(scoreBand) — simulation/test only、businessValidatedを問わない試算値】`,
    `    優先候補相当=${scoreBandPriorityCount} / テスト候補相当=${scoreBandTestCount} / 継続観測相当=${scoreBandObserveCount} / 除外相当=${scoreBandRejectCount}`,
    `    ※ここに表示される件数は「スコア計算のテスト結果」であり、fixtureや欠損データでも算出される。実運用可能な候補数ではない。`,
    `7b. 【実運用判定(decisionStatus) — scoreBandとは完全に分離した最終判定】`,
    `    需要データ検証済み件数(businessValidated=true)=${businessValidatedCount}件 / businessValidated=false(UNVALIDATED)=${unvalidatedCount}件`,
    `    【重要】decisionStatus=PRIORITY/TEST/OBSERVEは、rakutenSupplyStatus=ELIGIBLE(楽天ELIGIBLE商品が最低基準3件以上)の場合にのみ付与される。楽天商品が0件(SUPPLY_NO_MATCH)・1〜2件(SUPPLY_INSUFFICIENT)の候補は、scoreBandが高くてもdecisionStatus=PRIORITY等にはならない。`,
    `    スコア上のPRIORITY件数(scoreBand=PRIORITY、楽天供給状況を問わない試算値)=${scoreBandPriorityCount}件`,
    `    実運用上のPRIORITY件数(decisionStatus=PRIORITY かつ eligibleForApproval=true)=${operationalPriorityCount}件 / 実運用上のTEST=${operationalTestCount}件 / 実運用上のOBSERVE=${operationalObserveCount}件`,
    `    【重要】eligibleForApproval等は「人間が承認する対象にできる」という意味であり、自動で承認・出力・掲載されるという意味ではない。`,
    `    承認候補件数(eligibleForApproval、人間による承認ファイルなしでは何も出力・掲載されない)=${eligibleForApprovalCount}件`,
    `      内訳: PRIORITY帯=${approvalCandidateByBand.PRIORITY} / TEST帯=${approvalCandidateByBand.TEST} / OBSERVE帯=${approvalCandidateByBand.OBSERVE}(合計${eligibleForApprovalCount}件。PRIORITY件数だけと比較しないこと)`,
    `    出力対象件数(eligibleForExport、keywords:export-approvedで人間の承認ファイルと突き合わせて初めて実際に出力される)=${eligibleForExportCount}件`,
    `    承認済み件数(このdry-runレポートは承認ファイルを一切参照しないため常に0。実際の承認状況はkeywords:export-approvedの出力(approved-candidates.json)を参照)=${approvedCount}件`,
    `    掲載対象件数(eligibleForPublish、Phase3〈既存サイトへの接続〉が未実装のため常に0)=${eligibleForPublishCount}件`,
    businessValidatedCount === 0
      ? `    ⚠ businessValidated=trueが0件のため、実運用上の優先候補・承認候補・出力対象件数はすべて0件です(7aのスコア帯とは別物です)。`
      : ``,
    `7c. 【楽天照合の実行結果 — 需要データ検証とは独立(2026-09-05対応)】`,
    `    楽天照合成功件数(rakutenLookupStatus=SUCCESS)=${rakutenSuccessCount} / 楽天APIエラー件数(decisionStatus=SUPPLY_LOOKUP_ERROR)=${rakutenApiErrorCount}(${supplyLookupErrorDecisionCount}) / 未実行・安全ゲート等でスキップ(decisionStatus=SUPPLY_NOT_EVALUATED)=${rakutenNotRunCount}(${supplyNotEvaluatedDecisionCount})`,
    `    楽天商品不足件数(decisionStatus=SUPPLY_INSUFFICIENT、最低基準3件未満のみ一致)=${supplyInsufficientDecisionCount}件 / 楽天商品なし件数(decisionStatus=SUPPLY_NO_MATCH、0件一致)=${supplyNoMatchDecisionCount}件`,
    `    【重要】楽天APIエラーはbusinessValidatedを変更しない(需要データの検証結果と楽天照合の成否は別の状態として扱う)。SUPPLY_INSUFFICIENT/SUPPLY_NO_MATCH/SUPPLY_NOT_EVALUATED/SUPPLY_LOOKUP_ERRORのいずれも、scoreBandが高くても承認候補にはならない(decisionStatusがPRIORITY等を名乗ることもない)。`,
    `7d. 【安全ゲート・検索語品質】`,
    `    医療レビュー件数(safetyStatus=MEDICAL_REVIEW_REQUIRED)=${medicalReviewCount} / 健康訴求レビュー件数(HEALTH_REVIEW_REQUIRED)=${healthReviewCount}`,
    `    不自然な検索語件数: MALFORMED=${malformedCount} / REVIEW_REQUIRED(要確認、自動除外はしない)=${queryReviewRequiredCount}`,
    `    医療・健康レビュー対象および不自然な検索語は、businessValidatedの値に関わらず承認候補・出力対象・掲載対象のいずれにもしない。`,
    `8. 楽天商品一致数(ELIGIBLE≥1件のキーワード): ${rakutenMatchedCount}件`,
    `9. 手動確認件数: ${needsReview.length}件(NEEDS_MANUAL_REVIEW、理由はneeds-review.csv参照)`,
    `10. 医療関連除外数(intent=MEDICAL_REVIEW_REQUIRED): ${medicalExcluded}件(safetyStatusベースの医療レビュー件数は7d参照)`,
    `11. API失敗・欠損・フォールバック: ${apiFallbacks.length}件`,
    ...apiFallbacks.map((m) => `   - ${m.source}: ${m.note}`),
    `12. 出力対象件数(eligibleForExport、あくまで機械的な要件充足数=「出力され得る候補」であって「承認済み」ではない): ${eligibleForExportCount}件。実際に出力されるには、人間が作成した承認ファイル(approved-file)を指定してkeywords:export-approvedを実行することが必須(旧keywords:publishは非推奨エイリアスで同じ制限がかかる)。承認ファイルが無ければ1件も出力されない。`,
    `13. 【重要】これはdry-runのため、公開ページ・本番状態(articles-data.json/selected-products.json等)・承認状態の変更、commit、pushは一切行っていません。この機能は既存サイト生成(generate-site.js)・日次GitHub Actionsのいずれからも呼び出されていません。`,
    `14. 【重要・市場検証区分】businessValidated=true(実データで市場需要を検証済み): ${businessValidatedCount}件 / businessValidated=false(fixtureまたはデータ欠損があり実際の市場需要を示すものではない): ${candidates.length - businessValidatedCount}件。fixture由来のスコアを実需要・実運用候補として扱わないこと(keyword-scores.csvのbusinessValidated/dataSource/sourceProvider/isSynthetic列を参照)。`,
    ``,
  ].filter((line) => line !== "");
  await writeFile(`${runInfo.outDir}/summary.md`, summaryLines.join("\n"), "utf-8");

  // --- 再現性情報(2026-09-05 マージ前最終監査(3周目)対応) ---
  // 異なる実行結果を正しく比較できるように、候補集合・設定・データソースの
  // ハッシュ/内訳を記録する。シークレット(APIキー等)は一切含めない。
  await writeFile(
    `${runInfo.outDir}/run-metadata.json`,
    JSON.stringify(
      {
        runId: runInfo.runId,
        executedAt: new Date().toISOString(),
        mode: runInfo.mode,
        codeCommit: runInfo.codeCommit ?? null,
        inputFileHash: runInfo.inputFileHash ?? null,
        candidateCount: candidates.length,
        candidateSetHash,
        mappingConfigHash,
        searchSourceCounts,
        rakutenRequestParamsSummary: { endpoint: "IchibaItem/Search/20260701", hits: 30, sort: "-reviewCount", format: "json" },
      },
      null,
      2
    ),
    "utf-8"
  );

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
    metadataPath: `${runInfo.outDir}/run-metadata.json`,
    counts: {
      searchSourceCounts,
      candidateSetHash,
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
      approvedCount,
      publishTargetCount: eligibleForExportCount,
      rakutenSuccessCount,
      rakutenApiErrorCount,
      rakutenNotRunCount,
      rakutenInsufficientCount,
      rakutenNoMatchCount,
      supplyNoMatchDecisionCount,
      supplyInsufficientDecisionCount,
      supplyNotEvaluatedDecisionCount,
      supplyLookupErrorDecisionCount,
      medicalReviewCount,
      healthReviewCount,
      malformedCount,
      queryReviewRequiredCount,
    },
  };
}
