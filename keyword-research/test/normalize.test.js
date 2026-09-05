import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeyword } from "../normalize.js";
import { SYNONYM_DICTIONARY, COMPOUND_TOKEN_MERGES } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY, compoundTokenMerges: COMPOUND_TOKEN_MERGES };

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

// 【2026-09-05 GKP実データ監査対応】分割語の正規化(複合語の統合)。
// Googleキーワードプランナーの実データで「無添加」が「無 添加」と2トークンに
// 分割されるケースが333件確認されたため、語順ソートより前に統合する。

test("【監査対応】originalKeywordは書き換えられない", () => {
  const r = normalizeKeyword("無 添加 ドッグフード", config);
  assert.equal(r.originalKeyword, "無 添加 ドッグフード");
  assert.equal(r.original, "無 添加 ドッグフード");
});

test("【監査対応】「無 添加」は「無添加」として統合され、通常表記と同じcanonicalKeywordになる", () => {
  const split = normalizeKeyword("国産 無 添加 ドッグフード", config);
  const joined = normalizeKeyword("国産 無添加 ドッグフード", config);
  assert.equal(split.canonicalKeyword, joined.canonicalKeyword);
  assert.ok(split.canonicalKeyword.includes("無添加"));
  assert.ok(!split.canonicalKeyword.includes("添加 無") && !split.canonicalKeyword.split(" ").includes("添加"));
});

test("【監査対応】語順が逆の「添加 無」も「無添加」として統合される", () => {
  const r = normalizeKeyword("キャットフード 国産 添加 無", config);
  assert.ok(r.canonicalKeyword.split(" ").includes("無添加"));
});

test("【監査対応】「グレイン フリー」は「グレインフリー」として統合される(順不同)", () => {
  const a = normalizeKeyword("グレイン フリー 犬", config);
  const b = normalizeKeyword("フリー グレイン 犬", config);
  const c = normalizeKeyword("グレインフリー 犬", config);
  assert.equal(a.canonicalKeyword, c.canonicalKeyword);
  assert.equal(b.canonicalKeyword, c.canonicalKeyword);
  assert.ok(a.canonicalKeyword.split(" ").includes("グレインフリー"));
});

test("【監査対応】複合語正規化は無関係な隣接トークンまで結合しない", () => {
  // 「無」の次に「添加」以外の語が来た場合は統合しない
  const r = normalizeKeyword("無 添付 書類", config);
  const tokens = r.canonicalKeyword.split(" ");
  assert.ok(tokens.includes("無"));
  assert.ok(!tokens.includes("無添加"));
});
