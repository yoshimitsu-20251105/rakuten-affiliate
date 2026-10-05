// 【2026-10-05 Discovery/Availability分離対応】searchRakutenItemByCode()のテスト。
// keyword検索(Discovery)とは別の、商品コード指定での販売状態確認
// (Availability Verification)。keyword検索の順位(hits上限・sort条件)に
// 依存しないことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRakutenItemByCode } from "../rakuten-match.js";

const TEST_RATE_LIMIT_MS = 0;

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

function withRakutenEnv(fn) {
  const prevAppId = process.env.RAKUTEN_APP_ID;
  const prevSecret = process.env.RAKUTEN_SECRET;
  process.env.RAKUTEN_APP_ID = "test-app-id";
  process.env.RAKUTEN_SECRET = "test-secret";
  return fn().finally(() => {
    if (prevAppId === undefined) delete process.env.RAKUTEN_APP_ID;
    else process.env.RAKUTEN_APP_ID = prevAppId;
    if (prevSecret === undefined) delete process.env.RAKUTEN_SECRET;
    else process.env.RAKUTEN_SECRET = prevSecret;
  });
}

test("itemCodeパラメータを使い、keywordパラメータは送らない(商品コード指定、順位に依存しない照会)", async () => {
  await withRakutenEnv(async () => {
    let capturedUrl;
    await withMockedFetch(
      async (url) => {
        capturedUrl = new URL(String(url));
        return { ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: "shop:123", itemName: "テスト商品" } }], count: 1 }) };
      },
      async () => {
        await searchRakutenItemByCode("shop:123", { rateLimitMs: TEST_RATE_LIMIT_MS });
      }
    );
    assert.equal(capturedUrl.searchParams.get("itemCode"), "shop:123");
    assert.equal(capturedUrl.searchParams.get("hits"), "1");
    assert.equal(capturedUrl.searchParams.has("keyword"), false);
  });
});

test("該当商品が見つかった場合、item(商品情報)とsource:liveを返す", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ Items: [{ Item: { itemCode: "shop:123", itemName: "テスト商品", itemPrice: 1000 } }], count: 1 }) }),
      async () => {
        const result = await searchRakutenItemByCode("shop:123", { rateLimitMs: TEST_RATE_LIMIT_MS });
        assert.equal(result.source, "live");
        assert.equal(result.item.itemCode, "shop:123");
        assert.equal(result.item.itemPrice, 1000);
      }
    );
  });
});

test("該当商品が見つからない場合(販売終了等)、item:nullを返す(例外を投げない)", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ Items: [], count: 0 }) }),
      async () => {
        const result = await searchRakutenItemByCode("shop:does-not-exist", { rateLimitMs: TEST_RATE_LIMIT_MS });
        assert.equal(result.source, "live");
        assert.equal(result.item, null);
      }
    );
  });
});

test("HTTP異常応答(例: 429)は例外を投げる(黙って商品なし扱いにしない)", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: false, status: 429, text: async () => "Too Many Requests" }),
      async () => {
        await assert.rejects(() => searchRakutenItemByCode("shop:123", { rateLimitMs: TEST_RATE_LIMIT_MS }), /HTTP 429/);
      }
    );
  });
});

test("Itemsフィールドが配列でない(欠損等)異常応答は例外を投げる", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ count: 0 }) }),
      async () => {
        await assert.rejects(() => searchRakutenItemByCode("shop:123", { rateLimitMs: TEST_RATE_LIMIT_MS }), /Items/);
      }
    );
  });
});
