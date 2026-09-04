import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWebKeywordScore } from "../scoring.js";
import { SCORE_WEIGHTS, DEMAND_NORMALIZATION, TRUSTED_SOURCE_PROVIDERS } from "../config.js";

const config = { scoreWeights: SCORE_WEIGHTS, demandNormalization: DEMAND_NORMALIZATION, trustedSourceProviders: TRUSTED_SOURCE_PROVIDERS };
const matchedCluster = { matched: true };
const unmatchedCluster = { matched: false };

test("配点の合計は100点を超えない(境界値: 全項目満点)", () => {
  const obs = { source: "manual_csv", monthlySearches: DEMAND_NORMALIZATION.volumeCapForLog, competitionIndex: 0, trendIndex: 100 };
  const r = computeWebKeywordScore(obs, "CONDITION_PURCHASE", matchedCluster, 10, config);
  assert.ok(r.total <= 100);
  assert.equal(r.clusterFit, SCORE_WEIGHTS.clusterFit);
});

test("全項目0相当(境界値: 最低)", () => {
  const obs = { source: "manual_csv", monthlySearches: 0, competitionIndex: 100, trendIndex: 0 };
  const r = computeWebKeywordScore(obs, "INFORMATIONAL", unmatchedCluster, 0, config);
  assert.ok(r.total >= 0);
  assert.equal(r.clusterFit, 0);
});

test("MEDICAL_REVIEW_REQUIREDはpurchaseIntentが0点になる", () => {
  const obs = { source: "manual_csv", monthlySearches: 5000 };
  const r = computeWebKeywordScore(obs, "MEDICAL_REVIEW_REQUIRED", matchedCluster, 5, config);
  assert.equal(r.purchaseIntent, 0);
});

test("monthlySearches欠損(undefined)と実績0件は異なる扱いになる(reasonsで区別)", () => {
  // 他成分(adsCompetitionGap/trendAndStability)の欠損理由と混同しないよう、
  // demand成分のreasonだけを取り出して比較する
  const demandReason = (r) => r.startsWith("demand:") || r.startsWith("demand");
  const withZero = computeWebKeywordScore({ source: "manual_csv", monthlySearches: 0 }, "CONDITION_PURCHASE", matchedCluster, 3, config);
  const withMissing = computeWebKeywordScore({ source: "manual_csv" }, "CONDITION_PURCHASE", matchedCluster, 3, config);
  assert.equal(withZero.demand, 0);
  assert.equal(withMissing.demand, 0);
  // reasonsの文言で「欠損」と「実績ゼロと断定するものではない」旨が明記されている
  assert.ok(withMissing.reasons.filter(demandReason).some((r) => r.includes("欠損")));
  assert.ok(!withZero.reasons.filter(demandReason).some((r) => r.includes("欠損")));
});

test("【監査対応】データ欠損時に根拠のない中間点(0.5×配点)を加算しない: adsCompetitionGap/trendAndStabilityは欠損時0点", () => {
  // competitionIndex/competitionLevel/trendIndexをすべて欠損させる
  const r = computeWebKeywordScore({ source: "manual_csv", monthlySearches: 1000 }, "CONDITION_PURCHASE", matchedCluster, 3, config);
  assert.equal(r.adsCompetitionGap, 0, "競合指標欠損時は中間点(7.5点)ではなく0点でなければならない");
  assert.equal(r.trendAndStability, 0, "トレンド指標欠損時は中間点(5点)ではなく0点でなければならない");
  assert.ok(r.reasons.some((x) => x.includes("adsCompetitionGap") && x.includes("欠損")));
  assert.ok(r.reasons.some((x) => x.includes("trendAndStability") && x.includes("欠損")));
  // 「中央値」「中間点」という言葉で仮点数を正当化する文言が残っていないことも確認
  assert.ok(!r.reasons.some((x) => x.includes("中央値")));
});

test("欠損値が多いほどconfidenceが下がる", () => {
  const full = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000, competitionIndex: 50, trendIndex: 50 },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  const empty = computeWebKeywordScore({ source: "manual_csv" }, "CONDITION_PURCHASE", matchedCluster, 3, config);
  assert.equal(full.confidence, "HIGH");
  assert.equal(empty.confidence, "LOW");
});

test("楽天APIのcount(供給数)はスコアリング関数に渡していない: 同じeligibleCountなら結果が同じ", () => {
  const obs = { source: "manual_csv", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60 };
  // eligibleCount(適格商品数)だけを渡す設計であり、count(検索結果総数=供給数)は
  // このAPIのシグネチャに存在しない(=誤用しようがない)ことをコードレベルで担保する。
  const a = computeWebKeywordScore(obs, "CONDITION_PURCHASE", matchedCluster, 1, config);
  const b = computeWebKeywordScore(obs, "CONDITION_PURCHASE", matchedCluster, 1, config);
  assert.deepEqual(a, b);
  // 関数シグネチャに count(供給数)を受け取る引数は存在しない(observation/intent/cluster/
  // eligibleRakutenCount/config/dataQualityのみ) — eligibleRakutenCountだけを変えると
  // rakutenSupplyFitだけが変化し、他の成分は影響を受けないことを確認する
  const withMoreEligible = computeWebKeywordScore(obs, "CONDITION_PURCHASE", matchedCluster, 5, config);
  assert.notEqual(withMoreEligible.rakutenSupplyFit, a.rakutenSupplyFit);
  assert.equal(withMoreEligible.demand, a.demand);
  assert.equal(withMoreEligible.purchaseIntent, a.purchaseIntent);
});

test("fixtureフォールバック使用時はconfidenceがHIGHにならない", () => {
  const r = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60 },
    "CONDITION_PURCHASE",
    matchedCluster,
    5,
    config,
    { usedFixtureFallback: true }
  );
  assert.notEqual(r.confidence, "HIGH");
});

// 【2026-09-04監査対応】businessValidated判定表の直接検証。
// 「manual_csvという入力形式である」だけでtrue/falseを決めていないことを、
// 同じsource="manual_csv"でもsourceProvider/isSynthetic/取得期間の違いだけで
// 結果が変わることを通して確認する。

test("判定表: fixture(isSynthetic=true) → false", () => {
  const r = computeWebKeywordScore(
    { source: "fixture", sourceProvider: "fixture", isSynthetic: true, periodStart: "2026-08-01", periodEnd: "2026-08-31", monthlySearches: 1000, country: "JP", language: "ja" },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
  assert.ok(r.reasons.some((x) => x.includes("businessValidated=false") && x.includes("isSynthetic")));
});

test("判定表: 出所不明(sourceProvider未指定)のmanual_csv → false(検索量等が完備していても)", () => {
  const r = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60, country: "JP", language: "ja", periodStart: "2026-08-01" },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
  assert.ok(r.reasons.some((x) => x.includes("businessValidated=false") && x.includes("信頼できる出所")));
});

test("判定表: sourceProvider='unknown'を明示したmanual_csv → false", () => {
  const r = computeWebKeywordScore(
    { source: "manual_csv", sourceProvider: "unknown", isSynthetic: false, monthlySearches: 1000, country: "JP", language: "ja", periodStart: "2026-08-01" },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("判定表: Googleキーワードプランナー由来(sourceProvider='google_keyword_planner')でmanual_csv経由でも、必須項目(検索量・地域・言語・取得期間)が揃えばtrue", () => {
  const r = computeWebKeywordScore(
    {
      source: "manual_csv",
      sourceProvider: "google_keyword_planner",
      isSynthetic: false,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      monthlySearches: 480,
      country: "JP",
      language: "ja",
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, true);
});

test("判定表: Googleキーワードプランナー由来でも、対象地域・対象言語のどちらかが欠損していればfalse", () => {
  const r = computeWebKeywordScore(
    {
      source: "manual_csv",
      sourceProvider: "google_keyword_planner",
      isSynthetic: false,
      periodStart: "2026-08-01",
      monthlySearches: 480,
      // countryが欠損
      language: "ja",
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("判定表: Googleキーワードプランナー由来でも、取得期間(periodStart/periodEnd)が欠損していればfalse", () => {
  const r = computeWebKeywordScore(
    {
      source: "manual_csv",
      sourceProvider: "google_keyword_planner",
      isSynthetic: false,
      monthlySearches: 480,
      country: "JP",
      language: "ja",
      // periodStart/periodEndともに欠損
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("判定表: Google Ads APIの実データ(sourceProvider='google_ads_api') → true", () => {
  const r = computeWebKeywordScore(
    {
      source: "google_ads",
      sourceProvider: "google_ads_api",
      isSynthetic: false,
      periodStart: "2025-09-01",
      periodEnd: "2026-08-01",
      monthlySearches: 8100,
      country: "JP",
      language: "ja",
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, true);
});

test("判定表: Search Consoleで実impressionsが確認できるデータ(sourceProvider='search_console_api') → true", () => {
  const r = computeWebKeywordScore(
    {
      source: "search_console",
      sourceProvider: "search_console_api",
      isSynthetic: false,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-28",
      impressions: 340,
      country: "JP",
      language: "ja",
      // search_consoleにはmonthlySearchesという概念が無い(欠損していてもtrueになる)
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, true);
});

test("判定表: Search Console由来だが実impressionsが確認できない → false", () => {
  const r = computeWebKeywordScore(
    { source: "search_console", sourceProvider: "search_console_api", isSynthetic: false, periodStart: "2026-08-01", periodEnd: "2026-08-28" },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("判定表: 欠損値・推定値・テスト値(isSynthetic=true)は、信頼できる出所を名乗っていてもfalse", () => {
  const r = computeWebKeywordScore(
    {
      source: "manual_csv",
      sourceProvider: "google_keyword_planner",
      isSynthetic: true, // 人間が「これは推定値/テスト値」と明示したケース
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      monthlySearches: 480,
      country: "JP",
      language: "ja",
    },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("dataSourceが観測データのsourceをそのまま反映する", () => {
  const r1 = computeWebKeywordScore({ source: "manual_csv", monthlySearches: 100 }, "CONDITION_PURCHASE", matchedCluster, 1, config);
  const r2 = computeWebKeywordScore({ source: "fixture", monthlySearches: 100 }, "CONDITION_PURCHASE", matchedCluster, 1, config);
  assert.equal(r1.dataSource, "manual_csv");
  assert.equal(r2.dataSource, "fixture");
});
