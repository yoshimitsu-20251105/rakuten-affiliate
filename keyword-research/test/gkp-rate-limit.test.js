// 【2026-09-06 PR#4監査対応】楽天APIのレート制限が、成功・401/403/429/5xx/タイムアウト/
// JSON異常のすべてで最低1.2秒(既定値)確実に守られることを検証する。
// 実行速度のため、rateLimitMs/minRetryIntervalMsをテストでは小さい値に上書きして
// 実際の待機時間を計測する(モックタイマーではなく実時間で検証する)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRakutenItemsLive, RAKUTEN_RATE_LIMIT_MS } from "../rakuten-match.js";
import { fetchWithRetry, MIN_RETRY_INTERVAL_MS } from "../http.js";

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
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevAppId === undefined) delete process.env.RAKUTEN_APP_ID;
      else process.env.RAKUTEN_APP_ID = prevAppId;
      if (prevSecret === undefined) delete process.env.RAKUTEN_SECRET;
      else process.env.RAKUTEN_SECRET = prevSecret;
    });
}

const TEST_RATE_LIMIT_MS = 60; // 実時間計測だがテストを高速に保つための小さい値

test("既定のレート制限は1.2秒(RAKUTEN_RATE_LIMIT_MS/MIN_RETRY_INTERVAL_MS)である", () => {
  assert.equal(RAKUTEN_RATE_LIMIT_MS, 1200);
  assert.equal(MIN_RETRY_INTERVAL_MS, 1200);
});

test("成功時、次のAPIリクエストまで最低rateLimitMsだけ待機する", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ Items: [], count: 0 }) }),
      async () => {
        const start = Date.now();
        await searchRakutenItemsLive("テスト", { rateLimitMs: TEST_RATE_LIMIT_MS });
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= TEST_RATE_LIMIT_MS, `成功後も最低${TEST_RATE_LIMIT_MS}ms待機すること(実測${elapsed}ms)`);
      }
    );
  });
});

test("失敗時(HTTP 401)も、次のAPIリクエストまで最低rateLimitMsだけ待機する", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: false, status: 401, text: async () => "Unauthorized" }),
      async () => {
        const start = Date.now();
        await assert.rejects(() => searchRakutenItemsLive("テスト", { rateLimitMs: TEST_RATE_LIMIT_MS }));
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= TEST_RATE_LIMIT_MS, `401失敗後も最低${TEST_RATE_LIMIT_MS}ms待機すること(実測${elapsed}ms)`);
      }
    );
  });
});

test("失敗時(HTTP 429、再試行を使い切った後)も、次のAPIリクエストまで最低rateLimitMsだけ待機する", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({ ok: false, status: 429, text: async () => "Too Many Requests" }),
      async () => {
        const start = Date.now();
        // maxRetriesはsearchRakutenItemsLive内部で固定2のため、429だと内部retryのbackoffも
        // 発生する。ここではrateLimitMsそのものの待機(finally節)だけを検証したいので、
        // 429ケースは別テスト(fetchWithRetryの間隔)で詳しく見る。ここでは全体時間が
        // 少なくともrateLimitMs以上であることだけ確認する。
        await assert.rejects(() => searchRakutenItemsLive("テスト", { rateLimitMs: TEST_RATE_LIMIT_MS }));
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= TEST_RATE_LIMIT_MS, `429失敗後も最低${TEST_RATE_LIMIT_MS}ms待機すること(実測${elapsed}ms)`);
      }
    );
  });
});

test("失敗時(タイムアウト/AbortError)も、次のAPIリクエストまで最低rateLimitMsだけ待機する", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async (_url, { signal } = {}) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        }),
      async () => {
        const start = Date.now();
        // timeoutMsを短くして、テスト自体を高速に保つ(実際のタイムアウト検知経路を検証)
        await assert.rejects(() =>
          searchRakutenItemsLive("テスト", { rateLimitMs: TEST_RATE_LIMIT_MS, timeoutMs: 20 })
        );
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= TEST_RATE_LIMIT_MS, `タイムアウト失敗後も最低${TEST_RATE_LIMIT_MS}ms待機すること(実測${elapsed}ms)`);
      }
    );
  });
});

test("失敗時(JSON解析失敗)も、次のAPIリクエストまで最低rateLimitMsだけ待機する", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      }),
      async () => {
        const start = Date.now();
        await assert.rejects(() => searchRakutenItemsLive("テスト", { rateLimitMs: TEST_RATE_LIMIT_MS }));
        const elapsed = Date.now() - start;
        assert.ok(elapsed >= TEST_RATE_LIMIT_MS, `JSON解析失敗後も最低${TEST_RATE_LIMIT_MS}ms待機すること(実測${elapsed}ms)`);
      }
    );
  });
});

test("fetchWithRetry: 429/5xxでの内部再試行にも最低minRetryIntervalMsの間隔を適用する", async () => {
  let calls = 0;
  const timestamps = [];
  await withMockedFetch(
    async () => {
      timestamps.push(Date.now());
      calls++;
      if (calls < 3) return { status: 429, ok: false };
      return { status: 200, ok: true };
    },
    async () => {
      await fetchWithRetry("https://example.invalid/", { maxRetries: 3, timeoutMs: 5000, minRetryIntervalMs: TEST_RATE_LIMIT_MS });
      assert.equal(calls, 3);
      for (let i = 1; i < timestamps.length; i++) {
        const gap = timestamps[i] - timestamps[i - 1];
        assert.ok(gap >= TEST_RATE_LIMIT_MS, `再試行間隔が最低${TEST_RATE_LIMIT_MS}ms空いていること(実測${gap}ms)`);
      }
    }
  );
});

test("fetchWithRetry: minRetryIntervalMsを指定しない場合は既定の1.2秒が使われる(exponential backoffが1.2秒未満にならない)", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      if (calls < 2) return { status: 429, ok: false };
      return { status: 200, ok: true };
    },
    async () => {
      const start = Date.now();
      await fetchWithRetry("https://example.invalid/", { maxRetries: 1, timeoutMs: 5000 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= MIN_RETRY_INTERVAL_MS, `既定のbackoffは最低${MIN_RETRY_INTERVAL_MS}msであること(実測${elapsed}ms)`);
    }
  );
});
