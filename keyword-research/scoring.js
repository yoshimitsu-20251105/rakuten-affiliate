// WebKeywordScore(0〜100点)の算出。既存Quality Scoreとは完全に別軸のスコアであり、
// 商品価格・成果報酬率・検索数そのもの(生の大小)をQuality Score側に混ぜない。
//
// 配点(config.scoreWeights): demand30 + purchaseIntent25 + webCompetitionGap15
//   + trendAndStability10 + rakutenSupplyFit10 + clusterFit10 = 100
//
// 注意: Google AdsのCPC(lowTopOfPageBid/highTopOfPageBid)はスコアに使わない
// (購買意図の補助指標であり、自然検索SEO難易度そのものではないため)。
// レポート上はMonetizationMetricsとして別掲する。

/** @typedef {import('./types.js').KeywordObservation} KeywordObservation */
/** @typedef {import('./types.js').SearchIntent} SearchIntent */
/** @typedef {import('./types.js').KeywordScoreBreakdown} KeywordScoreBreakdown */

const INTENT_PURCHASE_SCORE_RATIO = {
  EXACT_PRODUCT: 0.8,
  CONDITION_PURCHASE: 1.0,
  COMMERCIAL_COMPARISON: 0.88,
  PROBLEM_SOLUTION: 0.48,
  INFORMATIONAL: 0.2,
  MEDICAL_REVIEW_REQUIRED: 0,
};

/**
 * @param {KeywordObservation} observation
 * @param {SearchIntent} intent
 * @param {{ matched: boolean }} clusterResult
 * @param {number} eligibleRakutenCount
 * @param {{ scoreWeights: Record<string,number>, demandNormalization: {volumeCapForLog:number} }} config
 * @param {{ usedFixtureFallback?: boolean }} [dataQuality]
 * @returns {KeywordScoreBreakdown}
 */
export function computeWebKeywordScore(observation, intent, clusterResult, eligibleRakutenCount, config, dataQuality = {}) {
  const w = config.scoreWeights;
  const reasons = [];
  let presentSoftFieldCount = 0;

  // --- demand (対数正規化。欠損は0件として扱わず、信頼度を下げるだけに留める) ---
  let demand = 0;
  if (typeof observation.monthlySearches === "number") {
    const cap = config.demandNormalization.volumeCapForLog;
    const ratio = Math.log(observation.monthlySearches + 1) / Math.log(cap + 1);
    demand = Math.min(ratio, 1) * w.demand;
    reasons.push(`demand: 月間検索数${observation.monthlySearches}件を対数正規化 → ${demand.toFixed(1)}点`);
    presentSoftFieldCount++;
  } else if (typeof observation.impressions === "number") {
    // Search Console実績(表示回数)で代替(自サイト実績のため参考値として弱めに評価)
    const ratio = Math.log(observation.impressions + 1) / Math.log(5000 + 1);
    demand = Math.min(ratio, 1) * w.demand * 0.7;
    reasons.push(`demand: 月間検索数が欠損のため、Search Console表示回数${observation.impressions}で代替(信頼度を下げて計算)`);
  } else {
    reasons.push("demand: 月間検索数・表示回数とも欠損のため0点として計算(実績ゼロと断定するものではない。信頼度LOW)");
  }

  // --- purchaseIntent (意図分類ベース) ---
  const purchaseIntent = (INTENT_PURCHASE_SCORE_RATIO[intent] ?? 0) * w.purchaseIntent;
  reasons.push(`purchaseIntent: 意図=${intent} → ${purchaseIntent.toFixed(1)}点`);

  // --- webCompetitionGap (競合の弱さ。CPCは使わない) ---
  let webCompetitionGap;
  if (typeof observation.competitionIndex === "number") {
    webCompetitionGap = ((100 - observation.competitionIndex) / 100) * w.webCompetitionGap;
    reasons.push(`webCompetitionGap: competitionIndex=${observation.competitionIndex} → ${webCompetitionGap.toFixed(1)}点`);
    presentSoftFieldCount++;
  } else if (observation.competitionLevel && observation.competitionLevel !== "UNKNOWN") {
    const levelRatio = { LOW: 1, MEDIUM: 0.5, HIGH: 0.15 }[observation.competitionLevel] ?? 0.5;
    webCompetitionGap = levelRatio * w.webCompetitionGap;
    reasons.push(`webCompetitionGap: competitionLevel=${observation.competitionLevel} → ${webCompetitionGap.toFixed(1)}点`);
    presentSoftFieldCount++;
  } else {
    webCompetitionGap = 0.5 * w.webCompetitionGap;
    reasons.push("webCompetitionGap: 競合指標が欠損のため中央値相当で計算(信頼度を下げる)");
  }

  // --- trendAndStability ---
  let trendAndStability;
  if (typeof observation.trendIndex === "number") {
    trendAndStability = (observation.trendIndex / 100) * w.trendAndStability;
    reasons.push(`trendAndStability: trendIndex=${observation.trendIndex} → ${trendAndStability.toFixed(1)}点`);
    presentSoftFieldCount++;
  } else {
    trendAndStability = 0.5 * w.trendAndStability;
    reasons.push("trendAndStability: trendIndexが欠損のため中央値相当で計算(信頼度を下げる)");
  }

  // --- rakutenSupplyFit (ELIGIBLE商品数。5件以上で満点) ---
  const rakutenSupplyFit = Math.min(eligibleRakutenCount / 5, 1) * w.rakutenSupplyFit;
  reasons.push(`rakutenSupplyFit: 楽天ELIGIBLE商品${eligibleRakutenCount}件 → ${rakutenSupplyFit.toFixed(1)}点`);

  // --- clusterFit ---
  const clusterFit = clusterResult.matched ? w.clusterFit : 0;
  reasons.push(`clusterFit: ${clusterResult.matched ? "6クラスターに一致" : "6クラスターに不一致"} → ${clusterFit}点`);

  const total = Math.round(demand + purchaseIntent + webCompetitionGap + trendAndStability + rakutenSupplyFit + clusterFit);

  // --- confidence ---
  let confidence = "LOW";
  if (presentSoftFieldCount >= 3 && !dataQuality.usedFixtureFallback) confidence = "HIGH";
  else if (presentSoftFieldCount >= 1) confidence = "MEDIUM";
  if (dataQuality.usedFixtureFallback) {
    reasons.push("楽天照合がfixtureフォールバック(認証未設定)で行われたため、信頼度をMEDIUM以下に制限");
    if (confidence === "HIGH") confidence = "MEDIUM";
  }

  return {
    demand: round1(demand),
    purchaseIntent: round1(purchaseIntent),
    webCompetitionGap: round1(webCompetitionGap),
    trendAndStability: round1(trendAndStability),
    rakutenSupplyFit: round1(rakutenSupplyFit),
    clusterFit,
    total,
    confidence,
    reasons,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
