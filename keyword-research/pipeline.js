// Web商品需要リサーチ〜楽天商品照合〜スコアリングの一連処理をまとめるオーケストレーション層。
// 各CLIコマンド(research/map-rakuten/report/dry-run)はここを呼び出す。
// 同じfixture・設定・基準日であれば同じ結果になる(非機能要件13章)。

import { loadConfig } from "./config.js";
import { normalizeKeyword } from "./normalize.js";
import { classifyIntent } from "./intent.js";
import { classifyCluster } from "./cluster.js";
import { classifySafety } from "./safety.js";
import { classifyQueryQuality } from "./query-quality.js";
import { buildRakutenQuery } from "./rakuten-query.js";
import { extractAttributes } from "./attributes.js";
import { groupByCanonicalKeyword } from "./dedupe.js";
import { createRakutenSearchFn, matchKeywordToItems } from "./rakuten-match.js";
import { computeWebKeywordScore } from "./scoring.js";
import { computeFinalPriority, classifyScoreBand } from "./final-priority.js";
import { computeProductQualityScore } from "./quality-score-adapter.js";
import { evaluateDecision } from "./decision.js";

import { fetchFromFixture } from "./sources/fixture.js";
import { fetchFromManualCsv } from "./sources/manual-csv.js";
import { fetchFromGoogleAds } from "./sources/google-ads.js";
import { fetchFromSearchConsole } from "./sources/search-console.js";
import { fetchFromGoogleTrends } from "./sources/google-trends.js";

/**
 * @param {{ manualCsvPath?: string, useGoogleAds?: boolean, useSearchConsole?: boolean, useGoogleTrends?: boolean, seedKeywords?: string[] }} options
 */
export async function collectObservations(options = {}) {
  const sourceMetas = [];
  let observations = [];

  if (options.manualCsvPath) {
    const result = await fetchFromManualCsv(options.manualCsvPath);
    observations.push(...result.observations);
    sourceMetas.push(result.meta);
  } else {
    const result = await fetchFromFixture();
    observations.push(...result.observations);
    sourceMetas.push(result.meta);
  }

  if (options.useGoogleAds) {
    const result = await fetchFromGoogleAds(options.seedKeywords ?? [], {
      fallback: async (reason) => {
        sourceMetas.push({ source: "google_ads:fallback_trigger", configured: false, fallbackUsed: true, note: reason });
        return options.manualCsvPath ? fetchFromManualCsv(options.manualCsvPath) : fetchFromFixture();
      },
    });
    observations.push(...result.observations);
    sourceMetas.push(result.meta);
  }

  if (options.useSearchConsole) {
    const result = await fetchFromSearchConsole();
    observations.push(...result.observations);
    sourceMetas.push(result.meta);
  }

  if (options.useGoogleTrends) {
    const result = await fetchFromGoogleTrends(options.seedKeywords ?? []);
    observations.push(...result.observations);
    sourceMetas.push(result.meta);
  }

  return { observations, sourceMetas };
}

/**
 * research段階: 収集 → 正規化 → 意図分類 → 6クラスター分類 → 安全ゲート → 検索語品質
 * → 楽天専用クエリ生成 → 重複統合
 */
export async function runResearch(options = {}) {
  const config = options.config ?? (await loadConfig());
  const { observations, sourceMetas } = await collectObservations(options);

  const normalized = observations.map((obs) => {
    const { canonicalKeyword, aliases } = normalizeKeyword(obs.keyword, config);
    return { canonicalKeyword, aliases, observation: obs };
  });

  const grouped = groupByCanonicalKeyword(normalized);

  const candidates = grouped.map((g) => {
    const intentResult = classifyIntent(g.canonicalKeyword, config);
    const clusterResult = classifyCluster(g.canonicalKeyword, config.clusters);
    const safetyResult = classifySafety(g.canonicalKeyword, config);
    const queryQualityResult = classifyQueryQuality(g.canonicalKeyword, config);
    const requiredAttributes = extractAttributes(g.canonicalKeyword);
    const searchPhrase = g.aliases[0] ?? g.canonicalKeyword;
    const rakutenQueryResult = buildRakutenQuery(searchPhrase, config);
    return {
      // originalKeyword/normalizedKeyword/rakutenQuery/keywordVariants の分離
      // (2026-09-05 GKP実データ監査対応)。originalKeywordは一切上書きしない。
      originalKeyword: g.mergedObservation.keyword,
      normalizedKeyword: g.canonicalKeyword,
      keywordVariants: g.aliases,
      rakutenQuery: rakutenQueryResult.valid ? rakutenQueryResult.rakutenQuery : null,
      queryQualityStatus: queryQualityResult.queryQualityStatus,
      queryQualityReasons: [...queryQualityResult.reasons, ...(!rakutenQueryResult.valid ? rakutenQueryResult.reasons : [])],

      canonicalKeyword: g.canonicalKeyword,
      aliases: g.aliases,
      searchPhrase,
      variantCount: g.variantCount,
      mergeReason: g.mergeReason,
      observation: g.mergedObservation,
      intent: intentResult.intent,
      intentReasons: intentResult.reasons,
      safetyStatus: safetyResult.safetyStatus,
      safetyReasons: safetyResult.reasons,
      cluster: clusterResult,
      requiredAttributes,
    };
  });

  return { candidates, sourceMetas, config };
}

/**
 * map-rakuten段階: research結果を受け取り、楽天商品照合 + WebKeywordScore + FinalPriority を計算する。
 *
 * 【2026-09-05 GKP実データ監査対応】
 * - businessValidatedは常にobservationの実データから計算し、楽天API照合の成否では
 *   一切書き換えない(需要データの検証と楽天照合結果を混同しない)。
 * - 安全ゲート(safetyStatus)・検索語品質(queryQualityStatus)・楽天クエリの有効性を
 *   満たさない候補は、楽天APIを呼び出さずにスキップする(無駄なAPI呼び出しをしない)。
 */
export async function runMapRakuten(researchResult, options = {}) {
  const { candidates, config } = researchResult;
  const { search, usedFixtureFallback } = options.searchFn
    ? { search: options.searchFn, usedFixtureFallback: options.usedFixtureFallback ?? false }
    : createRakutenSearchFn();

  const results = [];
  for (const candidate of candidates) {
    // businessValidatedは常に実データから計算する(楽天照合の成否とは独立)。
    // eligibleRakutenCountはこの時点では未確定のため0を暫定値として渡すが、
    // businessValidatedの算出はeligibleRakutenCountに依存しないため影響しない。
    const preScore = computeWebKeywordScore(candidate.observation, candidate.intent, candidate.cluster, 0, config, {});
    const businessValidated = preScore.businessValidated;

    const shouldSkipRakuten =
      candidate.safetyStatus !== "SAFE" || candidate.queryQualityStatus === "MALFORMED" || !candidate.rakutenQuery;

    if (shouldSkipRakuten) {
      const rakutenLookupStatus = "NOT_RUN";
      const decision = evaluateDecision({
        businessValidated,
        scoreBand: "REJECT",
        intent: candidate.intent,
        eligibleRakutenCount: 0,
        bestProductQualityScore: 0,
        safetyStatus: candidate.safetyStatus,
        queryQualityStatus: candidate.queryQualityStatus,
        rakutenLookupStatus,
      });
      const skipReason =
        candidate.safetyStatus !== "SAFE"
          ? `安全ゲート(${candidate.safetyStatus})のため楽天照合をスキップ`
          : candidate.queryQualityStatus === "MALFORMED"
            ? "検索語が不自然(MALFORMED)のため楽天照合をスキップ"
            : "楽天専用クエリが無効なため楽天照合をスキップ";
      results.push({
        ...candidate,
        rakuten: { matches: [], eligibleCount: 0, supplyCount: 0, searchSource: "skipped", note: skipReason },
        rakutenLookupStatus,
        rakutenSupplyStatus: "NOT_EVALUATED",
        webKeywordScore: preScore,
        businessValidated,
        bestProductQualityScore: 0,
        bestProductItemCode: null,
        finalPriority: 0,
        scoreBand: "REJECT",
        ...decision,
        publishBlockReasons: [...decision.validationFailureReasons, skipReason],
      });
      continue;
    }

    let searchResult;
    try {
      searchResult = await search(candidate.rakutenQuery);
    } catch (e) {
      // 【重要】楽天APIが失敗しても、需要データ自体の検証結果(businessValidated)は
      // 変更しない。楽天照合の失敗と需要データ未検証は別の状態として扱う。
      const decision = evaluateDecision({
        businessValidated,
        scoreBand: "REJECT",
        intent: candidate.intent,
        eligibleRakutenCount: 0,
        bestProductQualityScore: 0,
        safetyStatus: candidate.safetyStatus,
        queryQualityStatus: candidate.queryQualityStatus,
        rakutenLookupStatus: "API_ERROR",
      });
      results.push({
        ...candidate,
        rakuten: { matches: [], eligibleCount: 0, supplyCount: 0, searchSource: "error", error: e.message },
        rakutenLookupStatus: "API_ERROR",
        rakutenSupplyStatus: "NOT_EVALUATED",
        webKeywordScore: preScore,
        businessValidated,
        bestProductQualityScore: 0,
        bestProductItemCode: null,
        finalPriority: 0,
        scoreBand: "REJECT",
        ...decision,
        publishBlockReasons: [...decision.validationFailureReasons, `楽天API呼び出し失敗: ${e.message}`],
      });
      continue;
    }

    const { matches, eligibleCount, supplyCount } = matchKeywordToItems(
      candidate.canonicalKeyword,
      candidate.requiredAttributes,
      searchResult.items,
      config.matchingRules
    );

    const eligibleItems = searchResult.items.filter((item) =>
      matches.find((m) => m.itemCode === item.itemCode && m.status === "ELIGIBLE")
    );
    let bestProductQualityScore = 0;
    let bestProductItemCode = null;
    for (const item of eligibleItems) {
      const q = computeProductQualityScore(item);
      if (q > bestProductQualityScore) {
        bestProductQualityScore = q;
        bestProductItemCode = item.itemCode;
      }
    }

    const webKeywordScore = computeWebKeywordScore(
      candidate.observation,
      candidate.intent,
      candidate.cluster,
      eligibleCount,
      config,
      { usedFixtureFallback: usedFixtureFallback || searchResult.source === "fixture" }
    );

    const finalPriority = computeFinalPriority(webKeywordScore.total, bestProductQualityScore, config.finalPriorityWeights);
    const scoreBand = classifyScoreBand(finalPriority, config.adoptionThresholds);

    const rakutenSupplyStatus =
      eligibleCount >= config.matchingRules.minEligibleProductsForRankingPage
        ? "ELIGIBLE"
        : eligibleCount > 0
          ? "INSUFFICIENT"
          : "NO_MATCH";

    const decision = evaluateDecision({
      businessValidated: webKeywordScore.businessValidated,
      scoreBand,
      intent: candidate.intent,
      eligibleRakutenCount: eligibleCount,
      bestProductQualityScore,
      safetyStatus: candidate.safetyStatus,
      queryQualityStatus: candidate.queryQualityStatus,
      rakutenLookupStatus: "SUCCESS",
      rakutenSupplyStatus,
    });

    const publishBlockReasons = [...decision.validationFailureReasons];
    if (eligibleCount === 0) publishBlockReasons.push("楽天側の条件一致商品が0件");
    if (!candidate.cluster.matched) publishBlockReasons.push("6クラスターのいずれにも属さない");
    if (eligibleCount < config.matchingRules.minEligibleProductsForRankingPage) {
      publishBlockReasons.push(
        `ELIGIBLE商品が${eligibleCount}件(最低${config.matchingRules.minEligibleProductsForRankingPage}件未満のためランキングページ化は不可、候補保存のみ可)`
      );
    }

    results.push({
      ...candidate,
      rakuten: { matches, eligibleCount, supplyCount, searchSource: searchResult.source },
      rakutenLookupStatus: "SUCCESS",
      rakutenSupplyStatus,
      webKeywordScore,
      businessValidated: webKeywordScore.businessValidated,
      bestProductQualityScore,
      bestProductItemCode,
      finalPriority,
      scoreBand,
      ...decision,
      publishBlockReasons,
    });
  }

  return results;
}

/**
 * 統合ドライラン: research → map-rakuten をまとめて実行する。
 */
export async function runPipeline(options = {}) {
  const researchResult = await runResearch(options);
  const mapped = await runMapRakuten(researchResult, options);
  return { candidates: mapped, sourceMetas: researchResult.sourceMetas, config: researchResult.config };
}
