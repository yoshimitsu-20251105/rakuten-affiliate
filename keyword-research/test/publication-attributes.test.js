// 【2026-09-07 Phase 3B対応】公開ページ単位の必須属性定義とフレーバー選択注意文判定のテスト。

import { test } from "node:test";
import assert from "node:assert/strict";
import { PUBLICATION_PAGE_REQUIREMENTS, needsFlavorSelectionNote, FLAVOR_SELECTION_NOTE_TEXT } from "../publication-attributes.js";

test("犬ページ(senior-dog-pork)の必須属性は犬用・シニア・主食・豚肉", () => {
  const req = PUBLICATION_PAGE_REQUIREMENTS["senior-dog-pork"].requiredAttributes;
  assert.deepEqual(req.sort(), ["ingredient:pork", "lifeStage:senior", "productType:staple", "species:dog"].sort());
});

test("猫ページ(grain-free-cat-food)の必須属性は猫用・主食・グレインフリー", () => {
  const req = PUBLICATION_PAGE_REQUIREMENTS["grain-free-cat-food"].requiredAttributes;
  assert.deepEqual(req.sort(), ["feature:grain-free", "productType:staple", "species:cat"].sort());
});

test("「選べる」+複数フレーバー(豚肉含む)の商品は注意文が必要", () => {
  assert.equal(needsFlavorSelectionNote("選べる5個セット 豚肉 鶏肉 牛肉 ドッグフード"), true);
});

test("「よりどり」+複数フレーバーの商品も注意文が必要", () => {
  assert.equal(needsFlavorSelectionNote("よりどり3種 チキン ポーク サーモン"), true);
});

test("単一フレーバー(豚肉のみ)の商品は注意文不要", () => {
  assert.equal(needsFlavorSelectionNote("豚肉 ドッグフード 1kg"), false);
});

test("「選べる」表現があってもフレーバーが1種類だけなら注意文不要", () => {
  assert.equal(needsFlavorSelectionNote("選べる容量 豚肉 ドッグフード 1kg/5kg"), false);
});

test("FLAVOR_SELECTION_NOTE_TEXTは固定の安全な文言である", () => {
  assert.equal(FLAVOR_SELECTION_NOTE_TEXT, "購入時にポーク／豚肉タイプを選択してください");
});
