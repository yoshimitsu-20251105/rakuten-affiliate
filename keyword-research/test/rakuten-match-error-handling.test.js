// 【2026-09-05 マージ前最終監査(3周目)対応】
// searchRakutenItemsLive()がHTTPステータスを一切確認せず、レスポンスbodyに
// `error`/`errors`フィールドがあるかどうかだけで異常を判定していた欠陥の再発防止。
// 429/5xx等の異常応答やItemsフィールド欠損が、静かに「商品0件」(NO_MATCH)として
// 扱われないことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { searchRakutenItemsLive } from "../rakuten-match.js";
import { evaluateDecision } from "../decision.js";

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

test("HTTP 429(レート制限、bodyにerror/errorsフィールドを含まない)は例外を投げる(黙って商品0件にしない)", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      }),
      async () => {
        await assert.rejects(() => searchRakutenItemsLive("テスト"), /HTTP 429/);
      }
    );
  });
});

test("HTTP 5xx(bodyがJSONとして解析できても)は例外を投げる", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ Items: [], count: 0 }),
      }),
      async () => {
        await assert.rejects(() => searchRakutenItemsLive("テスト"), /HTTP 503/);
      }
    );
  });
});

test("HTTP 200だがItemsフィールドが存在しない(欠損)レスポンスは例外を投げる(空配列として処理しない)", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ count: 0 }), // Itemsフィールドが無い
      }),
      async () => {
        await assert.rejects(() => searchRakutenItemsLive("テスト"), /Items/);
      }
    );
  });
});

test("JSON解析自体に失敗した場合も例外を投げる", async () => {
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
        await assert.rejects(() => searchRakutenItemsLive("テスト"), /JSON解析/);
      }
    );
  });
});

test("正常系: HTTP 200・Itemsが空配列(本物の0件)は例外を投げず{items:[],count:0}を返す(誤ってエラー扱いしない)", async () => {
  await withRakutenEnv(async () => {
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ Items: [], count: 0 }),
      }),
      async () => {
        const result = await searchRakutenItemsLive("テスト");
        assert.deepEqual(result.items, []);
        assert.equal(result.count, 0);
        assert.equal(result.source, "live");
      }
    );
  });
});

test("decision.js: rakutenLookupStatus=API_ERRORはSUPPLY_LOOKUP_ERROR止まりであり、SUPPLY_NO_MATCH/SUPPLY_INSUFFICIENTには絶対にならない", () => {
  const decision = evaluateDecision({
    businessValidated: true,
    scoreBand: "PRIORITY",
    intent: "CONDITION_PURCHASE",
    eligibleRakutenCount: 0,
    bestProductQualityScore: 0,
    rakutenLookupStatus: "API_ERROR",
    // rakutenSupplyStatusを渡さない場合(pipeline.js実装と同様、API_ERROR時はNOT_EVALUATEDになる想定)
    rakutenSupplyStatus: "NOT_EVALUATED",
  });
  assert.equal(decision.decisionStatus, "SUPPLY_LOOKUP_ERROR");
  assert.notEqual(decision.decisionStatus, "SUPPLY_NO_MATCH");
  assert.notEqual(decision.decisionStatus, "SUPPLY_INSUFFICIENT");
  assert.equal(decision.eligibleForApproval, false);
});
