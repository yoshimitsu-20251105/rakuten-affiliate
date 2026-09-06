// 【2026-09-06 正式CLI対応】live/fixtureの厳格分離のテスト。
// --rakuten-source live は認証情報が無ければAPIを1件も呼ばず例外を投げる(fail closed)。
// fixtureへの自動フォールバックは絶対に行わない。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStrictRakutenSearchFn } from "../gkp-rakuten-source.js";

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(prev)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    });
}

test("live指定で認証情報が無い場合は例外を投げ、fixtureへフォールバックしない", async () => {
  await withEnv({ RAKUTEN_APP_ID: undefined, RAKUTEN_SECRET: undefined }, () => {
    assert.throws(() => createStrictRakutenSearchFn("live"), /RAKUTEN_APP_ID\/RAKUTEN_SECRETが未設定/);
  });
});

test("live指定で認証情報の片方だけ設定されている場合も例外を投げる", async () => {
  await withEnv({ RAKUTEN_APP_ID: "dummy", RAKUTEN_SECRET: undefined }, () => {
    assert.throws(() => createStrictRakutenSearchFn("live"));
  });
});

test("live指定で認証情報が揃っている場合は、liveの検索関数を返す(usedFixtureFallback=false)", async () => {
  await withEnv({ RAKUTEN_APP_ID: "dummy-id", RAKUTEN_SECRET: "dummy-secret" }, () => {
    const { search, usedFixtureFallback } = createStrictRakutenSearchFn("live");
    assert.equal(usedFixtureFallback, false);
    assert.equal(typeof search, "function");
  });
});

test("fixture指定は認証情報の有無に関わらず使用でき、usedFixtureFallback=trueを返す", async () => {
  await withEnv({ RAKUTEN_APP_ID: undefined, RAKUTEN_SECRET: undefined }, () => {
    const { search, usedFixtureFallback } = createStrictRakutenSearchFn("fixture");
    assert.equal(usedFixtureFallback, true);
    assert.equal(typeof search, "function");
  });
});

test("fixture指定は実際にfixtureデータを返す(緩い一致で検索できる)", async () => {
  const { search } = createStrictRakutenSearchFn("fixture");
  const result = await search("国産 無添加 ドッグフード");
  assert.equal(result.source, "fixture");
  assert.ok(Array.isArray(result.items));
});

test("rakuten-source未指定(undefined)は例外を投げる(安全のため既定値を補わない)", () => {
  assert.throws(() => createStrictRakutenSearchFn(undefined), /明示的に指定/);
});

test("rakuten-sourceに不正な値を渡した場合も例外を投げる", () => {
  assert.throws(() => createStrictRakutenSearchFn("production"), /明示的に指定/);
  assert.throws(() => createStrictRakutenSearchFn(""), /明示的に指定/);
});
