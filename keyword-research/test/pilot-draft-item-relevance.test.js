// 【2026-09-07 PR#6対応】Phase 3A専用: 表示商品単位の関連性ゲート(pilot-draft-item-relevance.js)の単体テスト。
// 保存済みrakuten-items.jsonの商品(itemName/catchcopyのみ、itemCaptionは保存されない)へ
// 独立に関連性判定を再適用する多層防御であることを検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyItemRelevance, filterRelevantItems } from "../pilot-draft-item-relevance.js";

test("classifyItemRelevance: 犬用商品が猫用ランキングへ混入している場合はrelevant=false", () => {
  const item = { itemCode: "shop:1", itemName: "犬用 グレインフリー ドッグフード", catchcopy: "" };
  const { relevant, reasonCodes } = classifyItemRelevance(item, ["species:cat", "productType:staple", "feature:grain-free"]);
  assert.equal(relevant, false);
  assert.ok(reasonCodes.includes("OPPOSITE_SPECIES_IN_ITEM_NAME"));
});

test("classifyItemRelevance: 正常な猫用商品はrelevant=true", () => {
  const item = { itemCode: "shop:2", itemName: "猫用 グレインフリー キャットフード 国産", catchcopy: "" };
  const { relevant, reasonCodes } = classifyItemRelevance(item, ["species:cat", "productType:staple", "feature:grain-free"]);
  assert.equal(relevant, true);
  assert.deepEqual(reasonCodes, []);
});

test("filterRelevantItems: 2026-09-07に実際に発見された犬用おやつ(itemCaption無し)を除外する", () => {
  const items = [
    {
      itemCode: "firstact:10000037",
      itemName:
        "【累計7万袋突破】選べる5個セット | 送料無料 犬 おやつ 無添加 どっぐふーどる 国産 さつまいも ジャーキー 詰め合わせ ドッグフード 犬のおやつ ドックフード 犬おやつ 犬用 小分け オヤツ キャットフード 猫 犬のオヤツ ペットフード",
      catchcopy: "新おやつ追加 小粒 小分け 野菜 プレゼント どっぐふーどる 犬用 おやつ 食べきりサイズ よりどり選べる5種 ペットフード グルテンフリー グレインフリー 詰め合わせ ギフト",
    },
    { itemCode: "shop:2", itemName: "猫用 グレインフリー キャットフード 国産 1", catchcopy: "" },
    { itemCode: "shop:3", itemName: "猫用 グレインフリー キャットフード 国産 2", catchcopy: "" },
    { itemCode: "shop:4", itemName: "猫用 グレインフリー キャットフード 国産 3", catchcopy: "" },
  ];
  const { relevantItems, excludedIrrelevantItems } = filterRelevantItems(items, ["species:cat", "productType:staple", "feature:grain-free"]);
  assert.equal(relevantItems.length, 3);
  assert.deepEqual(relevantItems.map((i) => i.itemCode).sort(), ["shop:2", "shop:3", "shop:4"]);
  assert.equal(excludedIrrelevantItems.length, 1);
  assert.equal(excludedIrrelevantItems[0].itemCode, "firstact:10000037");
  assert.ok(excludedIrrelevantItems[0].reasonCodes.length > 0);
});

test("filterRelevantItems: 除外商品の記録にはitemCodeとreasonCodesのみが含まれ、seller文言全文は含まれない", () => {
  const secretItemName = "これは絶対に記録されてはいけない販売者商品名XYZ999 犬用";
  const items = [{ itemCode: "shop:9", itemName: secretItemName, catchcopy: "" }];
  const { excludedIrrelevantItems } = filterRelevantItems(items, ["species:cat"]);
  assert.equal(excludedIrrelevantItems.length, 1);
  const serialized = JSON.stringify(excludedIrrelevantItems);
  assert.doesNotMatch(serialized, /XYZ999/);
  assert.match(serialized, /shop:9/);
});
