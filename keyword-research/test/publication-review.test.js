// 【2026-09-07 Phase 3B対応】公開候補商品レビュー資料の生成(publication-review.js)のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPageReview } from "../publication-review.js";
import { MEDICAL_TERMS, HEALTH_TERMS } from "../config.js";

const safetyConfig = { medicalTerms: MEDICAL_TERMS, healthTerms: HEALTH_TERMS };
const DOG_REQUIRED = ["species:dog", "lifeStage:senior", "productType:staple", "ingredient:pork"];

function item(itemCode, overrides = {}) {
  return {
    itemCode,
    itemName: `シニア犬用 豚肉入り ドッグフード ${itemCode}`,
    catchcopy: "",
    itemPrice: 3000,
    reviewAverage: 4.5,
    reviewCount: 100,
    shopName: `Shop-${itemCode}`,
    qualityScore: 80,
    ...overrides,
  };
}

test("buildPageReview: 条件を満たす商品はeligible=trueになる", () => {
  const candidate = { eligibleItems: [item("shop:1")] };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.itemReviews.length, 1);
  assert.equal(review.itemReviews[0].eligible, true);
  assert.deepEqual(review.itemReviews[0].verifiedAttributes.sort(), DOG_REQUIRED.sort());
});

test("buildPageReview: 動物種矛盾のある商品はeligible=falseになり除外理由が記録される", () => {
  const candidate = { eligibleItems: [item("shop:1", { itemName: "猫用 グレインフリー キャットフード" })] };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.itemReviews[0].eligible, false);
  assert.ok(review.itemReviews[0].exclusionReasons.length > 0);
});

test("buildPageReview: 医療語彙を含む商品はeligible=falseになる", () => {
  const candidate = { eligibleItems: [item("shop:1", { itemName: "食べれば病気が治るシニア犬用豚肉ドッグフード" })] };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.itemReviews[0].eligible, false);
  assert.ok(review.itemReviews[0].exclusionReasons.includes("MEDICAL_REVIEW_REQUIRED"));
});

test("buildPageReview: topCandidatesはeligibleな商品だけをQuality Score降順で最大10件返す", () => {
  const items = Array.from({ length: 15 }, (_, i) => item(`shop:${i}`, { qualityScore: i }));
  const candidate = { eligibleItems: items };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.topCandidates.length, 10);
  assert.equal(review.topCandidates[0].itemCode, "shop:14"); // qualityScore=14が最高
  assert.ok(review.topCandidates[0].qualityScore >= review.topCandidates[1].qualityScore);
});

test("buildPageReview: 複数フレーバーの豚肉選択商品はneedsFlavorSelectionNote=trueになる", () => {
  const candidate = { eligibleItems: [item("shop:1", { itemName: "選べる5種類 豚肉 鶏肉 牛肉 シニア犬用 ドッグフード" })] };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.itemReviews[0].needsFlavorSelectionNote, true);
});

test("buildPageReview: eligibleItemsが空の場合はitemReviews/topCandidatesとも空になる", () => {
  const candidate = { eligibleItems: [] };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.deepEqual(review.itemReviews, []);
  assert.deepEqual(review.topCandidates, []);
});

test("buildPageReview: diversity/sameSeriesGroupsはtopCandidatesに基づいて計算される", () => {
  const items = [
    item("shop:1", { shopName: "同じ店" }),
    item("shop:2", { shopName: "同じ店" }),
    item("shop:3", { shopName: "同じ店" }),
  ];
  const candidate = { eligibleItems: items };
  const review = buildPageReview({ candidate, requiredAttributes: DOG_REQUIRED, safetyConfig });
  assert.equal(review.diversity.exceedsMaxPerShop, true);
});
