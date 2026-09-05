// 【2026-09-05 GKP実データ監査対応】楽天API専用クエリ生成。
// 実際に楽天商品検索APIへ少数の検証クエリを送り、独立したトークンとして「の」「に」を
// 含むクエリだけが wrong_parameter で拒否されることを確認済み(6クエリ中3件が
// 100%再現)。この事実にもとづき、rakutenQueryからだけ助詞を除去する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRakutenQuery } from "../rakuten-query.js";
import { normalizeKeyword } from "../normalize.js";
import { RAKUTEN_QUERY_PARTICLE_TOKENS, SYNONYM_DICTIONARY } from "../config.js";

const config = { rakutenQueryParticleTokens: RAKUTEN_QUERY_PARTICLE_TOKENS };

test("独立した助詞「の」を除去する", () => {
  const r = buildRakutenQuery("シニア 犬 の 餌", config);
  assert.equal(r.valid, true);
  assert.equal(r.rakutenQuery, "シニア 犬 餌");
});

test("独立した助詞「に」を除去する", () => {
  const r = buildRakutenQuery("子犬 に 良い フード", config);
  assert.equal(r.valid, true);
  assert.equal(r.rakutenQuery, "子犬 良い フード");
});

test("単語内の部分文字列としての「の」は除去しない(「のど飴」のようなケース)", () => {
  const r = buildRakutenQuery("のど飴 犬 用", config);
  assert.equal(r.rakutenQuery, "のど飴 犬 用");
});

test("助詞が無いキーワードはそのまま", () => {
  const r = buildRakutenQuery("国産 無添加 ドッグフード", config);
  assert.equal(r.rakutenQuery, "国産 無添加 ドッグフード");
});

test("助詞除去後にクエリが空になる場合はvalid=falseでrakutenQuery=null(INVALID_RAKUTEN_QUERY)", () => {
  const r = buildRakutenQuery("の に", config);
  assert.equal(r.valid, false);
  assert.equal(r.rakutenQuery, null);
});

test("助詞除去後に1文字だけ残る場合もvalid=false", () => {
  const r = buildRakutenQuery("犬 の", config);
  assert.equal(r.valid, false);
});

test("【重要】rakutenQueryの加工はoriginalKeyword/normalizedKeywordに影響しない", () => {
  const original = "シニア 犬 の 餌";
  const normalized = normalizeKeyword(original, { synonyms: SYNONYM_DICTIONARY });
  const rakutenResult = buildRakutenQuery(original, config);
  // normalizedKeyword(canonicalKeyword)は助詞除去の影響を受けていないこと
  assert.ok(normalized.canonicalKeyword.split(" ").includes("の"), "canonicalKeywordには「の」が残っている(需要データ側は変更しない)");
  assert.equal(normalized.originalKeyword, original, "originalKeywordは変更されない");
  // rakutenQueryだけが助詞除去済み
  assert.equal(rakutenResult.rakutenQuery, "シニア 犬 餌");
});
