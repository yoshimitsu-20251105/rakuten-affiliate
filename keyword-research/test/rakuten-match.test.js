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

// --- 2026-09-07 PR#6対応: 商品関連性ゲート(itemName優先)の統合テスト ---
// 2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、犬用おやつが
// Quality Score 98で1位表示される誤判定が実際に発生した(itemName内に
// 「キャットフード」「猫」がSEOキーワードとして併記されていたため、
// 既存のEXCLUSIVE_GROUPS判定だけでは検出できなかった)。

test("【回帰テスト・実例】itemNameにSEOキーワードとして反対動物種を併記した実商品はQuality Scoreに関わらずREJECTED", () => {
  const keyword = "キャットフード グレインフリー"; // species:cat, productType:staple, feature:grain-free が必須
  const required = extractAttributes(keyword);
  const items = [
    {
      itemCode: "firstact:10000037",
      // 2026-09-07 live source runで実際に検出された商品名/catchcopy(rakuten.co.jpで公開されている情報)。
      itemName:
        "【累計7万袋突破】選べる5個セット | 送料無料 犬 おやつ 無添加 どっぐふーどる 国産 さつまいも ジャーキー 詰め合わせ ドッグフード 犬のおやつ ドックフード 犬おやつ 犬用 小分け オヤツ キャットフード 猫 犬のオヤツ ペットフード",
      catchcopy: "新おやつ追加 小粒 小分け 野菜 プレゼント どっぐふーどる 犬用 おやつ 食べきりサイズ よりどり選べる5種 ペットフード グルテンフリー グレインフリー 詰め合わせ ギフト",
      itemCaption: "",
    },
  ];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "REJECTED");
  assert.equal(matches[0].productRelevanceStatus, "REJECTED");
  assert.ok(matches[0].productRelevanceReasonCodes.length > 0);
});

test("必須species=catでitemNameに犬用商品と分かる記載がある場合はREJECTED(OPPOSITE_SPECIES_IN_ITEM_NAME)", () => {
  const keyword = "キャットフード グレインフリー";
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "b:1", itemName: "犬用 グレインフリー ドッグフード 1kg", catchcopy: "", itemCaption: "" }];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "REJECTED");
  assert.ok(matches[0].productRelevanceReasonCodes.includes("OPPOSITE_SPECIES_IN_ITEM_NAME"));
});

test("必須productType=stapleでitemNameに明確なジャーキー(おやつ)表記がある場合はREJECTED(TREAT_PRODUCT_FOR_STAPLE_QUERY)", () => {
  const keyword = "シニア 犬 フード"; // productType:staple が必須
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "c:1", itemName: "犬用 シニア ジャーキー", catchcopy: "", itemCaption: "" }];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "REJECTED");
  assert.ok(matches[0].productRelevanceReasonCodes.includes("TREAT_PRODUCT_FOR_STAPLE_QUERY"));
});

test("商品関連性ゲートを通過した正常な商品はmatchOneItem由来の判定(ELIGIBLE)を維持する", () => {
  const keyword = "国産 無添加 ドッグフード";
  const required = extractAttributes(keyword);
  const items = [{ itemCode: "d:1", itemName: "国産 無添加 ドッグフード 犬用", catchcopy: "", itemCaption: "" }];
  const { matches } = matchKeywordToItems(keyword, required, items, matchingRules);
  assert.equal(matches[0].status, "ELIGIBLE");
  assert.equal(matches[0].productRelevanceStatus, "RELEVANT");
});
