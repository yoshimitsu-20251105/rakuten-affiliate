import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCluster } from "../cluster.js";
import { normalizeKeyword } from "../normalize.js";
import { CLUSTERS, SYNONYM_DICTIONARY } from "../config.js";

const config = { synonyms: SYNONYM_DICTIONARY };

function canon(kw) {
  return normalizeKeyword(kw, config).canonicalKeyword;
}

test("国産無添加ドッグフードクラスターに一致する", () => {
  const r = classifyCluster(canon("国産 無添加 ドッグフード"), CLUSTERS);
  assert.equal(r.clusterId, "domestic-additive-free-dog-food");
});

test("シニア犬フードクラスターに一致する", () => {
  const r = classifyCluster(canon("シニア犬 フード"), CLUSTERS);
  assert.equal(r.clusterId, "senior-dog-food");
});

test("グレインフリーペットフードクラスターに一致する", () => {
  const r = classifyCluster(canon("グレインフリー キャットフード"), CLUSTERS);
  assert.equal(r.clusterId, "grain-free-pet-food");
});

test("6クラスターに該当しないキーワードはmatched=falseになる", () => {
  const r = classifyCluster(canon("電動歯ブラシ おすすめ"), CLUSTERS);
  assert.equal(r.matched, false);
  assert.equal(r.clusterId, null);
});
