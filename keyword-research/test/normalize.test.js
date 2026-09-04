import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyword } from "../normalize.js";
import { SYNONYM_DICTIONARY } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY };

test("全角/半角空白・連続空白を統一する", () => {
  const a = normalizeKeyword("国産　無添加  ドッグフード", config);
  const b = normalizeKeyword("国産 無添加 ドッグフード", config);
  assert.equal(a.canonicalKeyword, b.canonicalKeyword);
});

test("大文字小文字・全角記号を正規化する", () => {
  const a = normalizeKeyword("Ｄｏｇ Ｆｏｏｄ", config);
  const b = normalizeKeyword("dog food", config);
  assert.equal(a.canonicalKeyword, b.canonicalKeyword);
});

test("語順違いは同じcanonicalKeywordに集約される", () => {
  const a = normalizeKeyword("国産 無添加 ドッグフード", config);
  const b = normalizeKeyword("ドッグフード 無添加 国産", config);
  assert.equal(a.canonicalKeyword, b.canonicalKeyword);
});

test("限定的な同義語辞書(犬/ドッグ)で表記を統一する", () => {
  const a = normalizeKeyword("ドッグ 国産 無添加", config);
  const b = normalizeKeyword("犬 国産 無添加", config);
  assert.equal(a.canonicalKeyword, b.canonicalKeyword);
});

test("元キーワードをaliasesとして保持する(情報を失わない)", () => {
  const r = normalizeKeyword("国産 無添加 ドッグフード", config);
  assert.ok(r.aliases.includes("国産 無添加 ドッグフード"));
  assert.equal(r.original, "国産 無添加 ドッグフード");
});

test("異なる検索意図を持つ語を機械的にまとめない(シニアと子犬は別のcanonicalKeyword)", () => {
  const a = normalizeKeyword("シニア犬 フード", config);
  const b = normalizeKeyword("子犬 フード", config);
  assert.notEqual(a.canonicalKeyword, b.canonicalKeyword);
});
