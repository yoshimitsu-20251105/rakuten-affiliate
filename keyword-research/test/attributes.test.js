import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAttributes } from "../attributes.js";

test("犬・国産・無添加の属性タグを抽出する", () => {
  const tags = extractAttributes("国産 無添加 ドッグフード 犬");
  assert.ok(tags.includes("species:dog"));
  assert.ok(tags.includes("feature:domestic"));
  assert.ok(tags.includes("feature:additive-free"));
});

test("シニアはlifeStage:seniorとして抽出される", () => {
  const tags = extractAttributes("シニア犬 フード");
  assert.ok(tags.includes("lifeStage:senior"));
  assert.ok(tags.includes("species:dog"));
});

test("該当語がなければ空配列を返す", () => {
  const tags = extractAttributes("あいうえお");
  assert.deepEqual(tags, []);
});

// --- 2026-09-07 Phase 3B対応: ingredient:pork(豚肉)の検出 ---

test("【Phase 3B】「豚肉」「ポーク」「豚」からingredient:porkを検出する", () => {
  assert.ok(extractAttributes("犬用 豚肉 ドッグフード").includes("ingredient:pork"));
  assert.ok(extractAttributes("犬用 ポーク ドッグフード").includes("ingredient:pork"));
  assert.ok(extractAttributes("犬用 豚 ドッグフード").includes("ingredient:pork"));
});

test("【Phase 3B】無関係な語(鶏肉・チキンのみ)ではingredient:porkを誤検出しない", () => {
  const tags = extractAttributes("犬用 鶏肉 チキン ドッグフード");
  assert.ok(!tags.includes("ingredient:pork"), `誤検出: ${JSON.stringify(tags)}`);
});

test("【Phase 3B】牛肉・魚のみの商品ではingredient:porkを誤検出しない", () => {
  const tags = extractAttributes("犬用 牛肉 魚 ドッグフード");
  assert.ok(!tags.includes("ingredient:pork"), `誤検出: ${JSON.stringify(tags)}`);
});
