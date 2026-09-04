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
  assert.equal(groups[0].mergedObservation.monthlySearches, 8700); // 検索数は合算
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
