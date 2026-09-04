import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fetchFromFixture } from "../sources/fixture.js";
import { fetchFromManualCsv } from "../sources/manual-csv.js";
import { fetchFromGoogleAds } from "../sources/google-ads.js";
import { fetchFromSearchConsole } from "../sources/search-console.js";
import { fetchFromGoogleTrends } from "../sources/google-trends.js";

const SAMPLE_CSV_PATH = fileURLToPath(new URL("../fixtures/manual-keywords.sample.csv", import.meta.url));

test("fixtureアダプターはfixture.jsonから観測データを返す(認証不要)", async () => {
  const result = await fetchFromFixture();
  assert.ok(result.observations.length > 0);
  assert.equal(result.meta.source, "fixture");
  assert.equal(result.meta.configured, true);
});

test("【監査対応】fixtureアダプターは全観測にisSynthetic=trueを付与する(実需要ではないことを明示)", async () => {
  const result = await fetchFromFixture();
  assert.ok(result.observations.every((o) => o.isSynthetic === true));
  assert.ok(result.observations.every((o) => o.sourceProvider === "fixture"));
});

test("manual_csvアダプターはUTF-8の日本語CSVを正しく読み込む", async () => {
  const filePath = SAMPLE_CSV_PATH;
  const result = await fetchFromManualCsv(filePath);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations[0].keyword, "国産 無添加 ドッグフード 小型犬");
  assert.equal(result.observations[0].monthlySearches, 480);
});

test("manual_csvアダプターは欠損値をundefinedとして扱う(0とは区別)", async () => {
  const filePath = SAMPLE_CSV_PATH;
  const result = await fetchFromManualCsv(filePath);
  const grainFree = result.observations.find((o) => o.keyword.includes("グレインフリー"));
  assert.equal(grainFree.lowTopOfPageBid, undefined);
});

test("【監査対応】manual_csvアダプターはsourceProvider/isSynthetic/periodStart/periodEndを読み込む", async () => {
  const result = await fetchFromManualCsv(SAMPLE_CSV_PATH);
  const withProvider = result.observations.find((o) => o.keyword.includes("小型犬"));
  assert.equal(withProvider.sourceProvider, "google_keyword_planner");
  assert.equal(withProvider.isSynthetic, false);
  assert.equal(withProvider.periodStart, "2026-08-01");
  assert.equal(withProvider.periodEnd, "2026-08-31");
});

test("【監査対応】manual_csvでsourceProvider列が空欄の行は'unknown'として扱われる(出所不明)", async () => {
  const result = await fetchFromManualCsv(SAMPLE_CSV_PATH);
  const withoutProvider = result.observations.find((o) => o.keyword.includes("高齢猫"));
  assert.equal(withoutProvider.sourceProvider, "unknown");
});

test("【監査対応】manual_csvでisSynthetic列が'true'の行はisSynthetic=trueとしてパースされる", async () => {
  const result = await fetchFromManualCsv(SAMPLE_CSV_PATH);
  const synthetic = result.observations.find((o) => o.keyword.includes("グレインフリー"));
  assert.equal(synthetic.isSynthetic, true);
});

test("google_adsアダプター: 認証未設定時はfallbackへ委譲する(エラー終了しない)", async () => {
  const originalEnv = { ...process.env };
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  delete process.env.GOOGLE_ADS_CLIENT_ID;
  delete process.env.GOOGLE_ADS_CLIENT_SECRET;
  delete process.env.GOOGLE_ADS_REFRESH_TOKEN;
  delete process.env.GOOGLE_ADS_CUSTOMER_ID;

  let fallbackCalled = false;
  const result = await fetchFromGoogleAds(["国産 無添加 ドッグフード"], {
    fallback: async () => {
      fallbackCalled = true;
      return fetchFromFixture();
    },
  });

  assert.equal(fallbackCalled, true);
  assert.equal(result.meta.configured, false);
  assert.equal(result.meta.fallbackUsed, true);
  assert.ok(result.observations.length > 0);

  process.env = originalEnv;
});

test("search_consoleアダプター: 認証ファイル未設定でもエラーにならずskipする", async () => {
  // credentials/ga-search-console-key.json はテスト環境に存在しない前提のパスを指定して検証する
  const result = await fetchFromSearchConsole({ siteUrl: "https://example.invalid/" });
  assert.equal(result.meta.source, "search_console");
  // configuredはローカル環境のcredentials有無に依存するため、observationsが配列であることだけ確認する
  assert.ok(Array.isArray(result.observations));
});

test("google_trendsアダプター: 既定では無効(非公式スクレイピングを行わない)", async () => {
  const originalEnv = { ...process.env };
  delete process.env.GOOGLE_TRENDS_API_KEY;
  delete process.env.GOOGLE_TRENDS_API_ENDPOINT;

  const result = await fetchFromGoogleTrends(["国産 無添加 ドッグフード"]);
  assert.equal(result.meta.configured, false);
  assert.equal(result.observations.length, 0);

  process.env = originalEnv;
});
