import { test } from "node:test";
import assert from "node:assert/strict";
import { matchKeywordToItems } from "../rakuten-match.js";
import { extractAttributes } from "../attributes.js";

const matchingRules = { minEligibleProductsForRankingPage: 3 };

test("必須属性がすべて商品データに明記されていればELIGIBLE", () => {
  const keyword = "国産 無添加 ドッグフード";
  const required = extractAttributes(keyword);
  const items = [
    { itemCode: "a:1", itemName: "国産 無添加 ドッグフード 犬用", catchcopy: "", itemCaption: "" },
  ];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "ELIGIBLE");
  assert.deepEqual(matches[0].missingAttributes, []);
});

test("一部属性が根拠不足の場合はNEEDS_MANUAL_REVIEW(推定しない)", () => {
  const keyword = "国産 無添加 ドッグフード";
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "a:2", itemName: "ドッグフード 犬用 1kg", catchcopy: "", itemCaption: "" }]; // 国産・無添加の記載なし
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "NEEDS_MANUAL_REVIEW");
  assert.ok(matches[0].missingAttributes.length > 0);
});

test("必須属性と矛盾する記載(猫用と明記)がある商品はREJECTED", () => {
  const keyword = "国産 無添加 ドッグフード"; // species:dog が必須
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "a:3", itemName: "猫用 国産 無添加 キャットフード", catchcopy: "猫のための国産無添加フード", itemCaption: "" }];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "REJECTED");
  assert.ok(matches[0].conflictingAttributes.includes("species:cat"));
});

test("根拠が何もない商品(全属性が記載なし)はREJECTED", () => {
  const keyword = "国産 無添加 ドッグフード";
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "a:4", itemName: "電動歯ブラシ", catchcopy: "", itemCaption: "" }];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "REJECTED");
});

test("eligibleCountはELIGIBLEの件数のみを数える(NEEDS_MANUAL_REVIEW/REJECTEDは含めない)", () => {
  const keyword = "国産 無添加 ドッグフード";
  const required = extractAttributes(keyword);
  const items = [
    { itemCode: "a:1", itemName: "国産 無添加 ドッグフード 犬用", catchcopy: "", itemCaption: "" }, // ELIGIBLE
    { itemCode: "a:2", itemName: "ドッグフード 犬用", catchcopy: "", itemCaption: "" }, // NEEDS_MANUAL_REVIEW
    { itemCode: "a:4", itemName: "電動歯ブラシ", catchcopy: "", itemCaption: "" }, // REJECTED
  ];
  const { eligibleCount, supplyCount } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(eligibleCount, 1);
  assert.equal(supplyCount, 3); // supplyCountは取得件数(=商品供給数の参考値)であり、検索需要には使わない
});
