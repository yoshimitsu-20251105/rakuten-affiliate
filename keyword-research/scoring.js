// WebKeywordScore(0〜100点)の算出。既存Quality Scoreとは完全に別軸のスコアであり、
// 商品価格・成果報酬率・検索数そのもの(生の大小)をQuality Score側に混ぜない。
//
// 配点(config.scoreWeights): demand30 + purchaseIntent25 + adsCompetitionGap15
//   + trendAndStability10 + rakutenSupplyFit10 + clusterFit10 = 100
//
// 【2026-09-04 監査対応】
// 1. データ欠損時に「中央値相当(0.5×配点)」を仮点数として加算していた実装を廃止した。
//    根拠のないスコアを加算すると、fixture/manual_csvしか無い状態でも実データと
//    見分けのつかない点数が出てしまうため。欠損時は該当成分を0点とし、reasonsに
//    「欠損」である旨(実績ゼロと断定するものではない)を明記した上でconfidenceを
//    強制的にLOWへ落とし、businessValidatedをfalseにする。
// 2. `webCompetitionGap`は`adsCompetitionGap`に改称した。値の出所は
//    competitionLevel/competitionIndex(Google Ads Keyword Planningの入札競合指標)
//    であり、自然検索(SEO)の競合の強さそのものではない。自然検索の実際の競合状況を
//    測るデータ源は現時点で未接続のため、このスコアは「広告入札競合の代理指標」で
//    あることをフィールド名・reasons・レポート上で明示する。
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
 * @param {{ scoreWeights: Record<string,number>, demandNormalization: {volumeCapForLog:number}, trustedSourceProviders?: string[] }} config
 * @param {{ usedFixtureFallback?: boolean }} [dataQuality]
 * @returns {KeywordScoreBreakdown}
 */
export function computeWebKeywordScore(observation, intent, clusterResult, eligibleRakutenCount, config, dataQuality = {}) {
  const w = config.scoreWeights;
  const reasons = [];
  let presentSoftFieldCount = 0;
  let anyMissingSoftField = false;

  // --- demand (対数正規化。欠損は「実績ゼロ」と断定せず0点として計算し、reasons/confidence/
  //     businessValidatedで欠損であることを明示する。中間点は使わない) ---
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
    demand = 0;
    anyMissingSoftField = true;
    reasons.push("demand: 月間検索数・表示回数とも欠損。仮点数は加算せず0点として計算(実績ゼロと断定するものではない。欠損として扱う)");
  }

  // --- purchaseIntent (意図分類ベース) ---
  const purchaseIntent = (INTENT_PURCHASE_SCORE_RATIO[intent] ?? 0) * w.purchaseIntent;
  reasons.push(`purchaseIntent: 意図=${intent} → ${purchaseIntent.toFixed(1)}点`);

  // --- adsCompetitionGap (Google Ads入札競合の代理指標。自然検索SEO競合ではない。CPCは使わない) ---
  let adsCompetitionGap;
  if (typeof observation.competitionIndex === "number") {
    adsCompetitionGap = ((100 - observation.competitionIndex) / 100) * w.adsCompetitionGap;
    reasons.push(
      `adsCompetitionGap(広告入札競合の代理指標): competitionIndex=${observation.competitionIndex} → ${adsCompetitionGap.toFixed(1)}点`
    );
    presentSoftFieldCount++;
  } else if (observation.competitionLevel && observation.competitionLevel !== "UNKNOWN") {
    const levelRatio = { LOW: 1, MEDIUM: 0.5, HIGH: 0.15 }[observation.competitionLevel] ?? 0;
    adsCompetitionGap = levelRatio * w.adsCompetitionGap;
    reasons.push(
      `adsCompetitionGap(広告入札競合の代理指標): competitionLevel=${observation.competitionLevel} → ${adsCompetitionGap.toFixed(1)}点`
    );
    presentSoftFieldCount++;
  } else {
    adsCompetitionGap = 0;
    anyMissingSoftField = true;
    reasons.push("adsCompetitionGap: 競合指標が欠損。仮点数(中間点)は加算せず0点として計算");
  }

  // --- trendAndStability ---
  let trendAndStability;
  if (typeof observation.trendIndex === "number") {
    trendAndStability = (observation.trendIndex / 100) * w.trendAndStability;
    reasons.push(`trendAndStability: trendIndex=${observation.trendIndex} → ${trendAndStability.toFixed(1)}点`);
    presentSoftFieldCount++;
  } else {
    trendAndStability = 0;
    anyMissingSoftField = true;
    reasons.push("trendAndStability: trendIndexが欠損。仮点数(中間点)は加算せず0点として計算");
  }

  // --- rakutenSupplyFit (ELIGIBLE商品数。5件以上で満点。楽天APIのcount(供給数)は使わない) ---
  const rakutenSupplyFit = Math.min(eligibleRakutenCount / 5, 1) * w.rakutenSupplyFit;
  reasons.push(`rakutenSupplyFit: 楽天ELIGIBLE商品${eligibleRakutenCount}件 → ${rakutenSupplyFit.toFixed(1)}点`);

  // --- clusterFit ---
  const clusterFit = clusterResult.matched ? w.clusterFit : 0;
  reasons.push(`clusterFit: ${clusterResult.matched ? "6クラスターに一致" : "6クラスターに不一致"} → ${clusterFit}点`);

  const total = Math.round(demand + purchaseIntent + adsCompetitionGap + trendAndStability + rakutenSupplyFit + clusterFit);

  // --- confidence ---
  let confidence = "LOW";
  if (presentSoftFieldCount >= 3 && !dataQuality.usedFixtureFallback) confidence = "HIGH";
  else if (presentSoftFieldCount >= 1) confidence = "MEDIUM";
  if (dataQuality.usedFixtureFallback) {
    reasons.push("楽天照合がfixtureフォールバック(認証未設定)で行われたため、信頼度をMEDIUM以下に制限");
    if (confidence === "HIGH") confidence = "MEDIUM";
  }
  if (anyMissingSoftField && confidence === "HIGH") confidence = "MEDIUM"; // 念のための保険(通常はpresentSoftFieldCountで既に反映される)

  // --- businessValidated (2026-09-04監査で判定ロジックを刷新) ---
  // 「manual_csvという入力形式である」だけでtrue/falseを決めない。sourceProvider
  // (信頼できる出所か)・isSynthetic(推定値/テスト値でないか)・取得期間の有無・
  // データ種別ごとの必須項目、で判定する。
  const { businessValidated, businessValidationReason } = evaluateBusinessValidation(observation, config);
  reasons.push(businessValidationReason);

  return {
    demand: round1(demand),
    purchaseIntent: round1(purchaseIntent),
    adsCompetitionGap: round1(adsCompetitionGap),
    trendAndStability: round1(trendAndStability),
    rakutenSupplyFit: round1(rakutenSupplyFit),
    clusterFit,
    total,
    confidence,
    businessValidated,
    dataSource: observation.source ?? "unknown",
    reasons,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * businessValidated判定(2026-09-04監査対応)。
 *
 * 判定表:
 *   - fixture(isSynthetic=true)                        → false
 *   - manual_csvでsourceProviderが未指定/unknown         → false
 *   - manual_csvでsourceProvider="google_keyword_planner"
 *     かつisSynthetic=falseかつ取得期間・検索量・対象地域・
 *     対象言語が確認できる場合                            → true
 *   - google_ads(sourceProvider="google_ads_api")の実データ → true
 *   - search_console(sourceProvider="search_console_api")で
 *     実impressionsが確認できるデータ                      → true
 *   - 欠損値・推定値・テスト値                              → false
 *
 * @param {KeywordObservation} observation
 * @param {{ trustedSourceProviders?: string[] }} config
 * @returns {{ businessValidated: boolean, businessValidationReason: string }}
 */
function evaluateBusinessValidation(observation, config) {
  const trusted = config.trustedSourceProviders ?? [];
  const provider = observation.sourceProvider;

  if (observation.isSynthetic) {
    return {
      businessValidated: false,
      businessValidationReason:
        "businessValidated=false: isSynthetic=trueのデータ(fixture等の再現用/推定値/テスト値)であり、実際の市場需要を示すものではない",
    };
  }

  if (!provider || !trusted.includes(provider)) {
    return {
      businessValidated: false,
      businessValidationReason: `businessValidated=false: sourceProvider="${provider ?? "未指定"}"は信頼できる出所として登録されていない(config.trustedSourceProviders参照)。manual_csvという入力形式だけでは検証済みとみなさない`,
    };
  }

  const hasPeriod = Boolean(observation.periodStart || observation.periodEnd);
  if (!hasPeriod) {
    return {
      businessValidated: false,
      businessValidationReason: "businessValidated=false: 取得期間(periodStart/periodEnd)が確認できないため、いつ時点のデータか検証できない",
    };
  }

  // Search Consoleは実impressionsの有無で判定(検索量・競合・トレンドという概念自体が無いため)
  if (observation.source === "search_console") {
    if (typeof observation.impressions === "number") {
      return {
        businessValidated: true,
        businessValidationReason: `businessValidated=true: Search Console実績データ(impressions=${observation.impressions}、取得期間確認済み)`,
      };
    }
    return {
      businessValidated: false,
      businessValidationReason: "businessValidated=false: Search Console由来だが実impressionsが確認できない",
    };
  }

  // Google Ads API / Google Keyword Planner(manual_csv経由): 検索量・対象地域・対象言語が必須
  const hasVolume = typeof observation.monthlySearches === "number";
  const hasRegion = Boolean(observation.country);
  const hasLanguage = Boolean(observation.language);
  if (hasVolume && hasRegion && hasLanguage) {
    return {
      businessValidated: true,
      businessValidationReason: `businessValidated=true: 信頼できる出所(${provider})の実データ(検索量=${observation.monthlySearches}、対象地域=${observation.country}、対象言語=${observation.language}、取得期間確認済み)`,
    };
  }
  const missing = [!hasVolume && "検索量", !hasRegion && "対象地域", !hasLanguage && "対象言語"].filter(Boolean).join("・");
  return {
    businessValidated: false,
    businessValidationReason: `businessValidated=false: 信頼できる出所(${provider})だが必須項目(${missing})が欠損しているため検証済みとみなさない`,
  };
}
