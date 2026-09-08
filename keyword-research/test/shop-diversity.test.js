// 【2026-09-07 Phase 3B対応】商品・店舗の偏り防止(shop-diversity.js)のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNameSimilarity, evaluateShopDiversity, findSameSeriesGroups, hasExcessiveSameSeriesGroup } from "../shop-diversity.js";

test("computeNameSimilarity: 同一文字列は類似度1", () => {
  assert.equal(computeNameSimilarity("犬用ドッグフード", "犬用ドッグフード"), 1);
});

test("computeNameSimilarity: 完全に異なる文字列は類似度が低い", () => {
  const sim = computeNameSimilarity("犬用ドッグフード国産無添加", "猫用キャットフードグレインフリー");
  assert.ok(sim < 0.3, `類似度が高すぎる: ${sim}`);
});

test("computeNameSimilarity: 決定的(同じ入力なら常に同じ結果)", () => {
  const a = "グリーンプラス ドライフード ドッグフード チキン/ポーク/ビーフ 1kg入";
  const b = "グリーンプラス ドライフード ドッグフード ポーク 1kg入";
  const sim1 = computeNameSimilarity(a, b);
  const sim2 = computeNameSimilarity(a, b);
  assert.equal(sim1, sim2);
  assert.ok(sim1 > 0.6, `シリーズ商品の類似度が低すぎる: ${sim1}`);
});

test("evaluateShopDiversity: 同一shopが上限(2件)を超えると検出される", () => {
  const items = [
    { itemCode: "a:1", shopName: "shopA" },
    { itemCode: "a:2", shopName: "shopA" },
    { itemCode: "a:3", shopName: "shopA" },
    { itemCode: "b:1", shopName: "shopB" },
  ];
  const result = evaluateShopDiversity(items);
  assert.equal(result.exceedsMaxPerShop, true);
  assert.ok(result.overLimitShops.includes("shopA"));
});

test("evaluateShopDiversity: 各shop2件以下なら上限超過なし", () => {
  const items = [
    { itemCode: "a:1", shopName: "shopA" },
    { itemCode: "a:2", shopName: "shopA" },
    { itemCode: "b:1", shopName: "shopB" },
  ];
  const result = evaluateShopDiversity(items);
  assert.equal(result.exceedsMaxPerShop, false);
});

test("evaluateShopDiversity: 異なるshopが3店舗未満だとmeetsMinDistinctShops=false", () => {
  const items = [
    { itemCode: "a:1", shopName: "shopA" },
    { itemCode: "b:1", shopName: "shopB" },
  ];
  const result = evaluateShopDiversity(items);
  assert.equal(result.meetsMinDistinctShops, false);
  assert.equal(result.distinctShopCount, 2);
});

test("evaluateShopDiversity: 異なるshopが3店舗以上あればmeetsMinDistinctShops=true", () => {
  const items = [
    { itemCode: "a:1", shopName: "shopA" },
    { itemCode: "b:1", shopName: "shopB" },
    { itemCode: "c:1", shopName: "shopC" },
  ];
  const result = evaluateShopDiversity(items);
  assert.equal(result.meetsMinDistinctShops, true);
});

test("findSameSeriesGroups: 類似商品名が3件以上あれば1グループとして検出される", () => {
  const items = [
    { itemCode: "x:1", itemName: "グリーンプラス ドライフード ドッグフード チキン 1kg入" },
    { itemCode: "x:2", itemName: "グリーンプラス ドライフード ドッグフード ポーク 1kg入" },
    { itemCode: "x:3", itemName: "グリーンプラス ドライフード ドッグフード ビーフ 1kg入" },
    { itemCode: "y:1", itemName: "全く異なる商品名のキャットフードです" },
  ];
  const groups = findSameSeriesGroups(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test("hasExcessiveSameSeriesGroup: 同一シリーズが3件以上ならtrue", () => {
  const items = [
    { itemCode: "x:1", itemName: "グリーンプラス ドライフード ドッグフード チキン 1kg入" },
    { itemCode: "x:2", itemName: "グリーンプラス ドライフード ドッグフード ポーク 1kg入" },
    { itemCode: "x:3", itemName: "グリーンプラス ドライフード ドッグフード ビーフ 1kg入" },
  ];
  assert.equal(hasExcessiveSameSeriesGroup(items), true);
});

test("hasExcessiveSameSeriesGroup: 同一シリーズが2件以下ならfalse(候補には残してよい)", () => {
  const items = [
    { itemCode: "x:1", itemName: "グリーンプラス ドライフード ドッグフード チキン 1kg入" },
    { itemCode: "x:2", itemName: "グリーンプラス ドライフード ドッグフード ポーク 1kg入" },
    { itemCode: "y:1", itemName: "全く異なる商品名のキャットフードです" },
    { itemCode: "z:1", itemName: "もうひとつの全く異なる商品名です" },
  ];
  assert.equal(hasExcessiveSameSeriesGroup(items), false);
});

test("hasExcessiveSameSeriesGroup: 全て異なる商品ならfalse", () => {
  const items = [
    { itemCode: "a:1", itemName: "商品A" },
    { itemCode: "b:1", itemName: "商品B" },
    { itemCode: "c:1", itemName: "商品C" },
  ];
  assert.equal(hasExcessiveSameSeriesGroup(items), false);
});
