// Web商品需要リサーチ〜楽天商品照合〜スコアリングの一連処理をまとめるオーケストレーション層。
// 各CLIコマンド(research/map-rakuten/report/dry-run)はここを呼び出す。
// 同じfixture・設定・基準日であれば同じ結果になる(非機能要件13章)。

import { loadConfig } from "./config.js";
import { normalizeKeyword } from "./normalize.js";
import { classifyIntent } from "./intent.js";
import { classifyCluster } from "./cluster.js";
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
 * research段階: 収集 → 正規化 → 意図分類 → クラスター分類 → 重複統合
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
    const requiredAttributes = extractAttributes(g.canonicalKeyword);
    return {
      canonicalKeyword: g.canonicalKeyword,
      aliases: g.aliases,
      searchPhrase: g.aliases[0] ?? g.canonicalKeyword,
      variantCount: g.variantCount,
      mergeReason: g.mergeReason,
      observation: g.mergedObservation,
      intent: intentResult.intent,
      intentReasons: intentResult.reasons,
      cluster: clusterResult,
      requiredAttributes,
    };
  });

  return { candidates, sourceMetas, config };
}

/**
 * map-rakuten段階: research結果を受け取り、楽天商品照合 + WebKeywordScore + FinalPriority を計算する。
 */
export async function runMapRakuten(researchResult, options = {}) {
  const { candidates, config } = researchResult;
  const { search, usedFixtureFallback } = options.searchFn
    ? { search: options.searchFn, usedFixtureFallback: options.usedFixtureFallback ?? false }
    : createRakutenSearchFn();

  const results = [];
  for (const candidate of candidates) {
    // 医療関連キーワードは楽天照合をスキップ(自動公開しないため、無駄なAPI呼び出しをしない)
    if (candidate.intent === "MEDICAL_REVIEW_REQUIRED") {
      const decision = evaluateDecision({
        businessValidated: false,
        scoreBand: "REJECT",
        intent: candidate.intent,
        eligibleRakutenCount: 0,
        bestProductQualityScore: 0,
      });
      results.push({
        ...candidate,
        rakuten: { matches: [], eligibleCount: 0, supplyCount: 0, searchSource: "skipped" },
        webKeywordScore: null,
        businessValidated: false,
        bestProductQualityScore: 0,
        bestProductItemCode: null,
        finalPriority: 0,
        scoreBand: "REJECT",
        ...decision,
        publishBlockReasons: ["医療・疾病・治療関連のため自動公開禁止(MEDICAL_REVIEW_REQUIRED)", "BUSINESS_DATA_NOT_VALIDATED"],
      });
      continue;
    }

    let searchResult;
    try {
      searchResult = await search(candidate.searchPhrase);
    } catch (e) {
      const decision = evaluateDecision({
        businessValidated: false,
        scoreBand: "REJECT",
        intent: candidate.intent,
        eligibleRakutenCount: 0,
        bestProductQualityScore: 0,
      });
      results.push({
        ...candidate,
        rakuten: { matches: [], eligibleCount: 0, supplyCount: 0, searchSource: "error", error: e.message },
        webKeywordScore: null,
        businessValidated: false,
        bestProductQualityScore: 0,
        bestProductItemCode: null,
        finalPriority: 0,
        scoreBand: "REJECT",
        ...decision,
        publishBlockReasons: [`楽天API呼び出し失敗: ${e.message}`, "BUSINESS_DATA_NOT_VALIDATED"],
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

    // 【2026-09-05監査対応】businessValidatedを承認・出力ゲートとして強制する。
    // scoreBandがPRIORITYであっても、businessValidated=falseなら実運用上はUNVALIDATED。
    const decision = evaluateDecision({
      businessValidated: webKeywordScore.businessValidated,
      scoreBand,
      intent: candidate.intent,
      eligibleRakutenCount: eligibleCount,
      bestProductQualityScore,
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
