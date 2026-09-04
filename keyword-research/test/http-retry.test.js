import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../http.js";

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("429はbackoffして再試行し、最終的に成功する", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      if (calls < 2) return { status: 429, ok: false };
      return { status: 200, ok: true };
    },
    async () => {
      const res = await fetchWithRetry("https://example.invalid/", { maxRetries: 3, timeoutMs: 1000 });
      assert.equal(res.status, 200);
      assert.equal(calls, 2);
    }
  );
});

test("5xxは再試行し、上限に達したら最後のレスポンスを返す", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      return { status: 503, ok: false };
    },
    async () => {
      const res = await fetchWithRetry("https://example.invalid/", { maxRetries: 2, timeoutMs: 1000 });
      assert.equal(res.status, 503);
      assert.equal(calls, 3); // 初回 + maxRetries(2)
    }
  );
});

test("401/403は再試行せず即座に返す(無限retryしない)", async () => {
  let calls = 0;
  await withMockedFetch(
    async () => {
      calls++;
      return { status: 401, ok: false };
    },
    async () => {
      const res = await fetchWithRetry("https://example.invalid/", { maxRetries: 5, timeoutMs: 1000 });
      assert.equal(res.status, 401);
      assert.equal(calls, 1); // 再試行していない
    }
  );
});

test("timeout(AbortError)は再試行し、上限で例外を投げる", async () => {
  let calls = 0;
  await withMockedFetch(
    async (_url, { signal } = {}) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    },
    async () => {
      await assert.rejects(() => fetchWithRetry("https://example.invalid/", { maxRetries: 1, timeoutMs: 50 }));
      assert.equal(calls, 2); // 初回 + maxRetries(1)
    }
  );
});
