// 【2026-09-11監査対応】search-trial-analytics-clients.js のテスト。
// 各fetch関数はGoogle APIクライアントを引数として必須で受け取る設計になったため、
// テストでは常に明示的なmock clientだけを渡す(google.auth.GoogleAuth・実際の
// google.searchconsole()/google.analyticsdata()には一切触れない、外部API呼び出し0件)。
// クライアントを渡さない場合は例外を投げること(暗黙のクライアント生成をしないこと)、
// 権限不足はNOT_AVAILABLE等へ変換されること、レスポンス形状が不正な場合は例外を
// 投げることも確認する。秘密情報がエラーメッセージから除去されることも確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeErrorMessage,
  fetchSearchConsolePageMetrics,
  fetchUrlInspectionStatus,
  fetchGA4PageMetrics,
  fetchGA4CustomDimensionAvailability,
  fetchRakutenPerformance,
} from "../search-trial-analytics-clients.js";

function permissionDeniedError() {
  const e = new Error("The caller does not have permission");
  e.code = 403;
  return e;
}

test("sanitizeErrorMessage: Windowsファイルパスを除去する", () => {
  const msg = sanitizeErrorMessage("ENOENT: C:\\Users\\user\\projects\\rakuten-affiliate\\credentials\\ga-search-console-key.json が見つかりません");
  assert.doesNotMatch(msg, /C:\\Users/);
  assert.match(msg, /\(path omitted\)/);
});

test("sanitizeErrorMessage: サービスアカウントのメールアドレスを除去する", () => {
  const msg = sanitizeErrorMessage("認証エラー: my-service-account@my-project.iam.gserviceaccount.com に権限がありません");
  assert.doesNotMatch(msg, /iam\.gserviceaccount\.com/);
  assert.match(msg, /\(service account omitted\)/);
});

test("sanitizeErrorMessage: 値がundefined/nullでも例外を投げない", () => {
  assert.doesNotThrow(() => sanitizeErrorMessage(undefined));
  assert.doesNotThrow(() => sanitizeErrorMessage(null));
});

test("fetchSearchConsolePageMetrics: clientを渡さない場合は例外を投げる(暗黙のクライアント生成をしない)", async () => {
  await assert.rejects(() => fetchSearchConsolePageMetrics({ pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" }), /クライアントが渡されていません/);
});

test("fetchSearchConsolePageMetrics: mock clientの値をそのまま保存する(外部API呼び出しなし)", async () => {
  const client = {
    searchanalytics: {
      query: async ({ requestBody }) => {
        if (requestBody.dimensions.length === 0) return { data: { rows: [{ clicks: 10, impressions: 200, ctr: 0.05, position: 8 }] } };
        if (requestBody.dimensions[0] === "query") return { data: { rows: [{ keys: ["テストクエリ"], clicks: 5, impressions: 50, ctr: 0.1, position: 3 }] } };
        if (requestBody.dimensions[0] === "device") return { data: { rows: [{ keys: ["MOBILE"], clicks: 8, impressions: 150 }] } };
        return { data: { rows: [{ keys: ["jpn"], clicks: 9, impressions: 190 }] } };
      },
    },
  };
  const result = await fetchSearchConsolePageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "OK");
  assert.equal(result.clicks, 10);
  assert.equal(result.impressions, 200);
  assert.equal(result.topQueries[0].query, "テストクエリ");
  assert.equal(result.byDevice[0].device, "MOBILE");
  assert.equal(result.byCountry[0].country, "jpn");
});

test("fetchSearchConsolePageMetrics: 権限不足(403)の場合はNOT_AVAILABLEを返す(例外にしない)", async () => {
  const client = { searchanalytics: { query: async () => { throw permissionDeniedError(); } } };
  const result = await fetchSearchConsolePageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.equal(result.reason, "permission_denied");
});

test("fetchSearchConsolePageMetrics: レスポンス形状が不正(rowsが配列でない)場合は例外を投げる", async () => {
  const client = { searchanalytics: { query: async () => ({ data: { rows: "not-an-array" } }) } };
  await assert.rejects(
    () => fetchSearchConsolePageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" }),
    /形状が想定と異なります/
  );
});

test("fetchUrlInspectionStatus: clientを渡さない場合は例外を投げる", async () => {
  await assert.rejects(() => fetchUrlInspectionStatus({ pageUrl: "https://example.test/x.html" }), /クライアントが渡されていません/);
});

test("fetchUrlInspectionStatus: mock clientの値を保存する", async () => {
  const client = { urlInspection: { index: { inspect: async () => ({ data: { inspectionResult: { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } } } }) } } };
  const result = await fetchUrlInspectionStatus({ client, pageUrl: "https://example.test/x.html" });
  assert.equal(result.status, "OK");
  assert.equal(result.indexStatus, "PASS");
});

test("fetchUrlInspectionStatus: 権限不足の場合はINDEX_STATUS_NOT_AVAILABLEを返す", async () => {
  const client = { urlInspection: { index: { inspect: async () => { throw permissionDeniedError(); } } } };
  const result = await fetchUrlInspectionStatus({ client, pageUrl: "https://example.test/x.html" });
  assert.equal(result.status, "INDEX_STATUS_NOT_AVAILABLE");
  assert.equal(result.reason, "permission_denied");
});

test("fetchGA4PageMetrics: clientを渡さない場合は例外を投げる", async () => {
  await assert.rejects(() => fetchGA4PageMetrics({ pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" }), /クライアントが渡されていません/);
});

test("fetchGA4PageMetrics: mock clientの値を正しく保存する", async () => {
  let callCount = 0;
  const client = {
    properties: {
      runReport: async () => {
        callCount++;
        if (callCount === 1) return { data: { rows: [{ metricValues: [{ value: "10" }, { value: "12" }, { value: "20" }, { value: "0.5" }, { value: "30" }] }] } };
        return { data: { rows: [{ metricValues: [{ value: "3" }] }] } };
      },
    },
  };
  const result = await fetchGA4PageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "OK");
  assert.equal(result.activeUsers, 10);
  assert.equal(result.screenPageViews, 20);
  assert.equal(result.affiliateClickEventCount, 3);
});

test("fetchGA4PageMetrics: 権限不足の場合はNOT_AVAILABLEを返す", async () => {
  const client = { properties: { runReport: async () => { throw permissionDeniedError(); } } };
  const result = await fetchGA4PageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "NOT_AVAILABLE");
});

test("fetchGA4PageMetrics: レスポンス形状が不正な場合は例外を投げる", async () => {
  const client = { properties: { runReport: async () => ({ data: { rows: "not-an-array" } }) } };
  await assert.rejects(() => fetchGA4PageMetrics({ client, pageUrl: "https://example.test/x.html", startDate: "2026-09-10", endDate: "2026-09-16" }), /形状が想定と異なります/);
});

test("fetchGA4CustomDimensionAvailability: clientを渡さない場合は例外を投げる", async () => {
  await assert.rejects(() => fetchGA4CustomDimensionAvailability({}), /クライアントが渡されていません/);
});

test("fetchGA4CustomDimensionAvailability: 登録済みディメンションだけtrueにする(推測しない)", async () => {
  const client = { properties: { getMetadata: async () => ({ data: { dimensions: [{ apiName: "customEvent:animal_type" }] } }) } };
  const result = await fetchGA4CustomDimensionAvailability({ client });
  assert.equal(result.status, "OK");
  assert.equal(result.registered.animal_type, true);
  assert.equal(result.registered.item_rank, false);
  assert.equal(result.registered.selection_type, false);
  assert.equal(result.registered.page_type, false);
});

test("fetchRakutenPerformance: 常にNOT_CONNECTEDを返す(楽天APIを呼び出さない、clientも不要)", async () => {
  const result = await fetchRakutenPerformance();
  assert.equal(result.status, "NOT_CONNECTED");
  assert.equal(result.orders, "NOT_CONNECTED");
});
