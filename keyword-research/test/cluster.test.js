import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCluster } from "../cluster.js";
import { normalizeKeyword } from "../normalize.js";
import { CLUSTERS, SYNONYM_DICTIONARY, COMPOUND_TOKEN_MERGES } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY, compoundTokenMerges: COMPOUND_TOKEN_MERGES };

function canon(kw) {
  return normalizeKeyword(kw, config).canonicalKeyword;
}

test("国産無添加ドッグフードクラスターに一致する", () => {
  const r = classifyCluster(canon("国産 無添加 ドッグフード"), CLUSTERS);
  assert.equal(r.clusterId, "domestic-additive-free-dog-food");
});

test("シニア犬フードクラスターに一致する", () => {
  const r = classifyCluster(canon("シニア犬 フード"), CLUSTERS);
  assert.equal(r.clusterId, "senior-dog-food");
});

test("グレインフリーペットフードクラスターに一致する", () => {
  const r = classifyCluster(canon("グレインフリー キャットフード"), CLUSTERS);
  assert.equal(r.clusterId, "grain-free-pet-food");
});

test("6クラスターに該当しないキーワードはmatched=falseになる", () => {
  const r = classifyCluster(canon("電動歯ブラシ おすすめ"), CLUSTERS);
  assert.equal(r.matched, false);
  assert.equal(r.clusterId, null);
});

// 【2026-09-05 GKP実データ監査対応】分割語("無 添加"等)を含む実データが
// 正しいクラスターに分類されることを確認する(以前は「無添加」が「無」「添加」に
// 分割されたままだったため、6クラスター中4クラスターが実質0件になっていた)。

test("【監査対応】「国産 無 添加 ドッグフード」(分割語)は国産無添加ドッグフードクラスターに一致する", () => {
  const r = classifyCluster(canon("国産 無 添加 ドッグフード"), CLUSTERS);
  assert.equal(r.clusterId, "domestic-additive-free-dog-food");
});

test("【監査対応】「キャットフード 国産 添加 無」(語順・分割の両方)は国産無添加キャットフードクラスターに一致する", () => {
  const r = classifyCluster(canon("キャットフード 国産 添加 無"), CLUSTERS);
  assert.equal(r.clusterId, "domestic-additive-free-cat-food");
});

test("【監査対応】「グレイン フリー 犬」(分割語)はいずれかのクラスターに一致する(matched=true)", () => {
  const r = classifyCluster(canon("グレイン フリー 犬"), CLUSTERS);
  assert.equal(r.matched, true);
});

test("【監査対応】「グレイン シニア ドッグフード フリー」(分割語+シニア)はクラスターに一致する", () => {
  const r = classifyCluster(canon("グレイン シニア ドッグフード フリー"), CLUSTERS);
  assert.equal(r.matched, true);
});

test("【監査対応】「犬 おやつ 無 添加」(分割語)は分割語自体が正しく統合される", () => {
  const canonical = canon("犬 おやつ 無 添加");
  assert.ok(canonical.split(" ").includes("無添加"), "「無」「添加」が「無添加」へ統合されていること");
});

test("【監査対応】「犬 おやつ 無 添加」は「国産」を含まないため、国産無添加犬用おやつクラスターには一致しない(正しい非該当)", () => {
  const r = classifyCluster(canon("犬 おやつ 無 添加"), CLUSTERS);
  assert.equal(r.matched, false, "「国産」が無いため6クラスターのいずれにも一致しないのが正しい挙動");
});

test("【監査対応】「国産 犬 おやつ 無 添加」(分割語+国産)は国産無添加犬用おやつクラスターに一致する", () => {
  const r = classifyCluster(canon("国産 犬 おやつ 無 添加"), CLUSTERS);
  assert.equal(r.clusterId, "domestic-additive-free-dog-treats");
});
