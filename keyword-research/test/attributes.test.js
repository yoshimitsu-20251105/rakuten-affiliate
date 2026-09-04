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
