import { test } from "node:test";
import assert from "node:assert/strict";
import { computeWebKeywordScore } from "../scoring.js";
import { SCORE_WEIGHTS, DEMAND_NORMALIZATION } from "../config.js";

const config = { scoreWeights: SCORE_WEIGHTS, demandNormalization: DEMAND_NORMALIZATION };
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

test("【監査対応】businessValidated: 実データが完備している場合のみtrue", () => {
  const complete = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60 },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(complete.businessValidated, true);
});

test("【監査対応】businessValidated: fixture由来のデータは実データが揃っていてもfalse", () => {
  const r = computeWebKeywordScore(
    { source: "fixture", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60 },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
  assert.ok(r.reasons.some((x) => x.includes("businessValidated=false") && x.includes("fixture")));
});

test("【監査対応】businessValidated: 楽天照合がfixtureフォールバックの場合もfalse", () => {
  const r = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000, competitionIndex: 40, trendIndex: 60 },
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config,
    { usedFixtureFallback: true }
  );
  assert.equal(r.businessValidated, false);
});

test("【監査対応】businessValidated: 一部データが欠損しているとfalse", () => {
  const r = computeWebKeywordScore(
    { source: "manual_csv", monthlySearches: 1000 }, // competitionIndex/trendIndexが欠損
    "CONDITION_PURCHASE",
    matchedCluster,
    3,
    config
  );
  assert.equal(r.businessValidated, false);
});

test("【監査対応】dataSourceが観測データのsourceをそのまま反映する", () => {
  const r1 = computeWebKeywordScore({ source: "manual_csv", monthlySearches: 100 }, "CONDITION_PURCHASE", matchedCluster, 1, config);
  const r2 = computeWebKeywordScore({ source: "fixture", monthlySearches: 100 }, "CONDITION_PURCHASE", matchedCluster, 1, config);
  assert.equal(r1.dataSource, "manual_csv");
  assert.equal(r2.dataSource, "fixture");
});
