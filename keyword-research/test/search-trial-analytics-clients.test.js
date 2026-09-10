// 【2026-09-17 Phase 3C対応】search-trial-analytics-clients.js のテスト。
//
// 【重要】このリポジトリを実際に開発しているマシンには credentials/ga-search-console-key.json
// が実在する場合があり、「認証ファイルが無い」ことに暗黙に頼ったテストは、開発機によっては
// 実際のGA4/Search Console APIへ到達してしまう(このテストを書く過程で実際に発生した)。
// これを避けるため、GA_SEARCH_CONSOLE_KEY_FILE 環境変数を確実に存在しないパスへ設定し、
// 開発機の実際の認証情報の有無に関わらず「未設定」を強制してからimportする。

process.env.GA_SEARCH_CONSOLE_KEY_FILE = "/definitely/does/not/exist/search-trial-analytics-clients-test.json";

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAnalyticsConfigured,
  sanitizeErrorMessage,
  fetchSearchConsolePageMetrics,
  fetchUrlInspectionStatus,
  fetchGA4PageMetrics,
  fetchGA4CustomDimensionAvailability,
  fetchRakutenPerformance,
} from "../search-trial-analytics-clients.js";

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

test("isAnalyticsConfigured: GA_SEARCH_CONSOLE_KEY_FILEが存在しないパスの場合はfalseを返す(開発機の実際のcredentials/の有無に依存しない)", () => {
  assert.equal(isAnalyticsConfigured(), false);
});

test("fetchSearchConsolePageMetrics: 認証未設定の場合はNOT_AVAILABLEを返し、例外を投げない(外部API呼び出しなし)", async () => {
  const result = await fetchSearchConsolePageMetrics({ pageUrl: "https://example.test/rankings/senior-dog-pork.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.equal(result.reason, "credentials_not_configured");
});

test("fetchUrlInspectionStatus: 認証未設定の場合はINDEX_STATUS_NOT_AVAILABLEを返す", async () => {
  const result = await fetchUrlInspectionStatus({ pageUrl: "https://example.test/rankings/senior-dog-pork.html" });
  assert.equal(result.status, "INDEX_STATUS_NOT_AVAILABLE");
});

test("fetchGA4PageMetrics: 認証未設定の場合はNOT_AVAILABLEを返す", async () => {
  const result = await fetchGA4PageMetrics({ pageUrl: "https://example.test/rankings/senior-dog-pork.html", startDate: "2026-09-10", endDate: "2026-09-16" });
  assert.equal(result.status, "NOT_AVAILABLE");
});

test("fetchGA4CustomDimensionAvailability: 認証未設定の場合はNOT_AVAILABLEを返し、registeredを推測しない(空)", async () => {
  const result = await fetchGA4CustomDimensionAvailability();
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.deepEqual(result.registered, {});
});

test("fetchRakutenPerformance: 常にNOT_CONNECTEDを返す(楽天APIを呼び出さない)", async () => {
  const result = await fetchRakutenPerformance();
  assert.equal(result.status, "NOT_CONNECTED");
  assert.equal(result.orders, "NOT_CONNECTED");
  assert.equal(result.revenue, "NOT_CONNECTED");
  assert.equal(result.commission, "NOT_CONNECTED");
  assert.equal(result.conversionRate, "NOT_CONNECTED");
});
