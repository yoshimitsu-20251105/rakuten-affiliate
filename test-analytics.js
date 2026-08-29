// GA4 / Search Console 連携の動作確認用スクリプト。
// 実行: node test-analytics.js
import { google } from "googleapis";
import { readFileSync } from "fs";

const KEY_FILE = "./credentials/ga-search-console-key.json";
const GA4_PROPERTY_ID = "550074703";
const GSC_SITE_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function testGA4(auth) {
  console.log("\n=== GA4 (Google Analytics Data API) ===");
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const res = await analyticsData.properties.runReport({
    property: `properties/${GA4_PROPERTY_ID}`,
    requestBody: {
      dateRanges: [{ startDate: dateNDaysAgo(7), endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    },
  });
  const rows = res.data.rows || [];
  if (rows.length === 0) {
    console.log("接続は成功しましたが、直近7日間のデータがまだありません(計測開始直後の可能性)。");
    return;
  }
  for (const row of rows) {
    const [date] = row.dimensionValues.map((v) => v.value);
    const [users, views] = row.metricValues.map((v) => v.value);
    console.log(`${date}: ユーザー数=${users}, ページビュー=${views}`);
  }
}

async function testSearchConsole(auth) {
  console.log("\n=== Search Console (Search Analytics API) ===");
  const searchconsole = google.searchconsole({ version: "v1", auth });
  const res = await searchconsole.searchanalytics.query({
    siteUrl: GSC_SITE_URL,
    requestBody: {
      startDate: dateNDaysAgo(28),
      endDate: dateNDaysAgo(1),
      dimensions: ["query"],
      rowLimit: 10,
    },
  });
  const rows = res.data.rows || [];
  if (rows.length === 0) {
    console.log("接続は成功しましたが、直近28日間のデータがまだありません(インデックス・計測が反映されるまで数日かかる場合があります)。");
    return;
  }
  console.log("直近28日間の検索クエリ上位:");
  for (const row of rows) {
    console.log(`  "${row.keys[0]}" — クリック数=${row.clicks}, 表示回数=${row.impressions}, 掲載順位=${row.position.toFixed(1)}`);
  }
}

async function main() {
  let keyInfo;
  try {
    keyInfo = JSON.parse(readFileSync(KEY_FILE, "utf-8"));
  } catch (e) {
    console.error(`認証ファイルが読み込めませんでした: ${KEY_FILE}`);
    console.error(e.message);
    process.exit(1);
  }
  console.log(`サービスアカウント: ${keyInfo.client_email}`);

  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/webmasters.readonly",
    ],
  });

  let ga4Ok = false;
  let gscOk = false;

  try {
    await testGA4(auth);
    ga4Ok = true;
  } catch (e) {
    console.error("\n=== GA4 接続エラー ===");
    console.error(e.message);
  }

  try {
    await testSearchConsole(auth);
    gscOk = true;
  } catch (e) {
    console.error("\n=== Search Console 接続エラー ===");
    console.error(e.message);
  }

  console.log("\n=== 結果まとめ ===");
  console.log(`GA4: ${ga4Ok ? "OK" : "NG"}`);
  console.log(`Search Console: ${gscOk ? "OK" : "NG"}`);
  if (!ga4Ok || !gscOk) process.exitCode = 1;
}

main();
