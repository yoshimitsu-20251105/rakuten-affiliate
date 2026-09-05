import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyword } from "../normalize.js";
import { groupByCanonicalKeyword } from "../dedupe.js";
import { SYNONYM_DICTIONARY } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY };

function makeEntry(keyword, monthlySearches) {
  const { canonicalKeyword, aliases } = normalizeKeyword(keyword, config);
  return { canonicalKeyword, aliases, observation: { keyword, monthlySearches, source: "fixture", observedAt: "2026-09-04T00:00:00Z" } };
}

test("語順違いのキーワードは1グループに統合される(カニバリゼーション防止)", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 8000), makeEntry("ドッグフード 無添加 国産", 700)];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].variantCount, 2);
  assert.equal(groups[0].mergedObservation.monthlySearches, 8000); // 【監査対応】合算ではなく最大値
});

// 【2026-09-05 GKP実データ監査対応】monthlySearchesの二重計上防止をテストで固定する。
// Googleキーワードプランナーは近似語・語順違いに同一または重複した検索ボリュームを
// 割り当てることがあるため、単純合算すると需要を過大評価する。

test("【監査対応】語順違い統合時、monthlySearchesは合算せず最大値を採用する", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 500), makeEntry("ドッグフード 無添加 国産", 5000)];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].mergedObservation.monthlySearches, 5000);
  assert.notEqual(groups[0].mergedObservation.monthlySearches, 5500, "合算(500+5000)になっていないこと");
});

test("【監査対応】統合された値が異なる場合、searchVolumeVarianceに元の値を記録する", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 500), makeEntry("ドッグフード 無添加 国産", 5000)];
  const groups = groupByCanonicalKeyword(entries);
  const variance = groups[0].mergedObservation.searchVolumeVariance;
  assert.ok(variance, "値が異なる場合はsearchVolumeVarianceが記録される");
  assert.deepEqual([...variance.values].sort((a, b) => a - b), [500, 5000]);
  assert.equal(variance.max, 5000);
  assert.equal(variance.min, 500);
});

test("【監査対応】統合された値が同一の場合、searchVolumeVarianceは記録されない", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 500), makeEntry("ドッグフード 無添加 国産", 500)];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups[0].mergedObservation.monthlySearches, 500);
  assert.equal(groups[0].mergedObservation.searchVolumeVariance, undefined);
});

test("【監査対応】3件以上の統合でも最大値のみが採用される(合算にならない)", () => {
  const entries = [
    makeEntry("国産 無添加 ドッグフード", 100),
    makeEntry("ドッグフード 無添加 国産", 200),
    makeEntry("無添加 国産 ドッグフード", 50),
  ];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups[0].mergedObservation.monthlySearches, 200);
});

test("【監査対応】統合前の各観測(originalKeyword個別)がsourceObservationsに保持される", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 500), makeEntry("ドッグフード 無添加 国産", 5000)];
  const groups = groupByCanonicalKeyword(entries);
  const sourceObservations = groups[0].mergedObservation.sourceObservations;
  assert.equal(sourceObservations.length, 2);
  assert.deepEqual(
    sourceObservations.map((o) => o.monthlySearches).sort((a, b) => a - b),
    [500, 5000]
  );
});

test("対象・条件が異なるキーワードは統合されない(シニア犬向けと子犬向けは別ページ)", () => {
  const entries = [makeEntry("シニア犬 フード", 1000), makeEntry("子犬 フード", 900)];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups.length, 2);
});

test("統合しなかった場合はvariantCount=1で理由が記録される", () => {
  const entries = [makeEntry("国産 無添加 ドッグフード", 8000)];
  const groups = groupByCanonicalKeyword(entries);
  assert.equal(groups[0].variantCount, 1);
  assert.match(groups[0].mergeReason, /統合対象なし/);
});
