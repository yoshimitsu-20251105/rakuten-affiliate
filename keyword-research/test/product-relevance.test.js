// 【2026-09-07 PR#6対応】商品関連性ゲート(product-relevance.js)の単体テスト。
//
// 2026-09-07にPhase 3A下書き「キャットフード グレインフリー」で、犬用おやつ
// (商品名に「キャットフード」「猫」がSEOキーワードとして併記)がQuality Score 98で
// 1位表示される誤判定が実際に発生した。ここでは、その実際に発見された商品名を
// 固定テストデータとして含める(rakuten.co.jpで公開されている商品タイトル・
// キャッチコピーであり、認証情報・個人情報は含まない)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateProductRelevance } from "../product-relevance.js";

// 2026-09-07 live source run(phase3a-live-2026-09-07-01)で実際に検出された商品
// (itemCode: firstact:10000037)のitemName/catchcopy。
const REAL_MISCLASSIFIED_ITEM = {
  itemName:
    "【累計7万袋突破】選べる5個セット | 送料無料 犬 おやつ 無添加 どっぐふーどる 国産 さつまいも ジャーキー 詰め合わせ ドッグフード 犬のおやつ ドックフード 犬おやつ 犬用 小分け オヤツ キャットフード 猫 犬のオヤツ ペットフード",
  catchcopy: "新おやつ追加 小粒 小分け 野菜 プレゼント どっぐふーどる 犬用 おやつ 食べきりサイズ よりどり選べる5種 ペットフード グルテンフリー グレインフリー 詰め合わせ ギフト",
};

test("【回帰テスト・実例】2026-09-07に誤って1位混入した実商品(犬用おやつ+キャットフードSEO併記)はREJECTED", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat", "productType:staple", "feature:grain-free"],
    ...REAL_MISCLASSIFIED_ITEM,
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.length > 0, "reasonCodesが記録されていること");
});

test("【テスト1】required species=cat、商品名「犬用おやつジャーキー キャットフード 猫」→ REJECTED", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "犬用おやつジャーキー キャットフード 猫",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
});

test("【テスト2】required species=dog、商品名に明確な猫用表記 → REJECTED", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog"],
    itemName: "猫用 国産 無添加 キャットフード 1kg",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("OPPOSITE_SPECIES_IN_ITEM_NAME"));
});

test("【テスト3】犬と猫の両方を商品名に含む(明示的な兼用表記ではない) → REJECTED(AMBIGUOUS_SPECIES)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "犬 猫 どちらにもおすすめのペットフード",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("AMBIGUOUS_SPECIES"));
});

test("【テスト4】「犬猫用」「犬猫兼用」は専用ランキングではREJECTED(MULTI_SPECIES_NOT_SPECIFIC)", () => {
  const resultDual = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "犬猫用 国産無添加フード 1kg",
    catchcopy: "",
  });
  assert.equal(resultDual.status, "REJECTED");
  assert.ok(resultDual.reasonCodes.includes("MULTI_SPECIES_NOT_SPECIFIC"));

  const resultKenyou = evaluateProductRelevance({
    requiredAttributes: ["species:dog"],
    itemName: "犬猫兼用 爪とぎポール",
    catchcopy: "",
  });
  assert.equal(resultKenyou.status, "REJECTED");
  assert.ok(resultKenyou.reasonCodes.includes("MULTI_SPECIES_NOT_SPECIFIC"));
});

test("【テスト5】required productType=staple、商品名にジャーキー → REJECTED(TREAT_PRODUCT_FOR_STAPLE_QUERY)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog", "productType:staple"],
    itemName: "犬用 シニア ジャーキー 1袋",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("TREAT_PRODUCT_FOR_STAPLE_QUERY"));
});

test("【テスト6】required productType=staple、商品名におやつ → REJECTED(TREAT_PRODUCT_FOR_STAPLE_QUERY)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog", "productType:staple"],
    itemName: "犬用 国産 無添加 おやつ",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("TREAT_PRODUCT_FOR_STAPLE_QUERY"));
});

test("【逆方向】required productType=treat、商品名に明確な主食専用品(おやつ表記なし) → REJECTED(STAPLE_PRODUCT_FOR_TREAT_QUERY)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog", "productType:treat"],
    itemName: "犬用 国産 無添加 ドッグフード 主食 1kg",
    catchcopy: "",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("STAPLE_PRODUCT_FOR_TREAT_QUERY"));
});

test("【テスト7】catchcopyに猫があってもitemNameが明確に犬用 → REJECTED(OPPOSITE_SPECIES_IN_ITEM_NAME、上書きされない)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "国産 無添加 ドッグフード 犬用 1kg",
    catchcopy: "猫にもおすすめ、グレインフリーキャットフードとしても人気です",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("OPPOSITE_SPECIES_IN_ITEM_NAME"));
});

test("【テスト8】正常な猫用グレインフリーキャットフード → RELEVANT", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat", "productType:staple", "feature:grain-free"],
    itemName: "猫用 グレインフリー キャットフード 国産 1kg",
    catchcopy: "穀物不使用で消化にやさしい主食フードです",
  });
  assert.equal(result.status, "RELEVANT");
  assert.deepEqual(result.reasonCodes, []);
});

test("【テスト9】正常なシニア犬向け豚肉ドッグフード → RELEVANT", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog", "lifeStage:senior"],
    itemName: "シニア犬用 豚肉入り ドッグフード 1kg",
    catchcopy: "国産豚肉を使用した総合栄養食です",
  });
  assert.equal(result.status, "RELEVANT");
  assert.deepEqual(result.reasonCodes, []);
});

test("itemNameだけでは必須動物種を確認できないがcatchcopyでは確認できる場合はREVIEW_REQUIRED(自動採用しない)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "グレインフリー ペットフード 国産 1kg",
    catchcopy: "愛猫のための無添加フードです",
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.reasonCodes.includes("REQUIRED_SPECIES_NOT_CONFIRMED_IN_TITLE"));
});

test("itemNameにもcatchcopyにも必須動物種の根拠が無い場合はREJECTED(REQUIRED_SPECIES_NOT_CONFIRMED)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:cat"],
    itemName: "グレインフリー ペットフード 国産 1kg",
    catchcopy: "無添加で安心です",
  });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("REQUIRED_SPECIES_NOT_CONFIRMED"));
});

test("requiredAttributesが空の場合は常にRELEVANT(判定材料が無い場合に過剰検出しない)", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: [],
    itemName: "何かの商品",
    catchcopy: "",
  });
  assert.equal(result.status, "RELEVANT");
});

test("itemName/catchcopyが未指定でも例外を投げない(nullish安全)", () => {
  const result = evaluateProductRelevance({ requiredAttributes: ["species:dog"] });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.reasonCodes.includes("REQUIRED_SPECIES_NOT_CONFIRMED"));
});

test("detectedTitleAttributes/detectedFullTextAttributesが両方とも返される", () => {
  const result = evaluateProductRelevance({
    requiredAttributes: ["species:dog"],
    itemName: "犬用 ドッグフード",
    catchcopy: "国産です",
  });
  assert.ok(Array.isArray(result.detectedTitleAttributes));
  assert.ok(Array.isArray(result.detectedFullTextAttributes));
  assert.ok(result.detectedTitleAttributes.includes("species:dog"));
});
