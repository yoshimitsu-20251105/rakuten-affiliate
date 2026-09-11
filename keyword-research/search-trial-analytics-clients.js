// Phase 3C(検索公開試験レポート)専用: GA4 Data API / Search Console API への
// 読み取り専用アクセス層(2026-09-11監査対応で全面改訂)。
//
// 既存のtest-analytics.js・keyword-research/sources/search-console.jsと同じ認証情報
// (credentials/ga-search-console-key.json)・同じscope(analytics.readonly /
// webmasters.readonly)を再利用する。新しいGA4プロパティ・サービスアカウントは作成しない。
//
// 【2026-09-11監査対応・重要】開発・テスト中に、ローカルに実在するcredentials/
// ga-search-console-key.json経由で実際のGA4/Search Console APIへ複数回、意図せず
// 読み取りアクセスしてしまう事故が発生した。原因は「認証情報ファイルが存在すれば
// 接続できる」設計だったこと(環境変数を差し替えるテスト対策はあったが、それだけに
// 依存していた)。この修正では:
//   1. Google APIクライアントの生成(createLiveGoogleClients)を、
//      keyword-research/search-trial-live-gate.js の4条件ゲート(--live・
//      feature flag・認証env var・有効な認証ファイル)を通過した場合にのみ
//      呼び出し側(CLI)が行うようにし、このモジュール自身は暗黙にクライアントを
//      生成しない(認証ファイルの既定パスへの自動fallabackも行わない)。
//   2. 各fetch関数はGoogle APIクライアントのインスタンスを引数として必須で受け取る
//      (呼び出し側が明示的に渡したものだけを使う)。テストは常にmockクライアントを
//      渡すことで、実際のgoogle.auth.GoogleAuthを一切生成せずに検証できる。
//
// 【重要・fail closed/fail open の使い分け(ゲート通過後、個別の取得エラーに関する方針)】
// - 個別の権限不足(403等)・データ未反映(空レスポンス自体は正常な0件として扱う。
//   権限不足とは区別する): その項目だけNOT_AVAILABLE / INDEX_STATUS_NOT_AVAILABLE /
//   CUSTOM_DIMENSION_NOT_REGISTEREDとして返す(処理全体は失敗させない)。
// - レスポンスの形状が想定と異なる(APIの仕様変更等でこのコードの前提が崩れている
//   可能性がある): 例外を投げる(呼び出し側で非ゼロ終了・出力なしとする)。
//
// GA4 Admin APIによる新規カスタムディメンション登録、Search Consoleへの
// サイトマップ送信・インデックス登録リクエストは一切行わない(読み取り専用)。

import { google } from "googleapis";
import { SITE_URL } from "../lib/site-config.js";

const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || "550074703";
const GSC_SITE_URL = process.env.GSC_SITE_URL || `${SITE_URL}/`;

const AFFILIATE_CLICK_CUSTOM_DIMENSIONS = ["item_rank", "animal_type", "selection_type", "page_type"];

/**
 * search-trial-live-gate.js のゲートを通過した後にだけ呼び出すこと。
 * ここで生成するのは各APIクライアントのオブジェクトのみで、この呼び出し自体は
 * ネットワークアクセスを行わない(実際の通信は各fetch関数がclientを使った時点)。
 * @param {{ keyFilePath: string }} options
 * @returns {{ searchconsole: object, analyticsdata: object }}
 */
export function createLiveGoogleClients({ keyFilePath }) {
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly", "https://www.googleapis.com/auth/webmasters.readonly"],
  });
  return {
    searchconsole: google.searchconsole({ version: "v1", auth }),
    analyticsdata: google.analyticsdata({ version: "v1beta", auth }),
  };
}

// 【重要】ログ・成果物に認証情報を出力しないため、エラーメッセージから
// ファイルパス・トークン等が含まれていそうな箇所を機械的に取り除く。
export function sanitizeErrorMessage(message) {
  return String(message ?? "")
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "(path omitted)")
    .replace(/[\w.-]+@[\w.-]+\.iam\.gserviceaccount\.com/g, "(service account omitted)");
}

function isPermissionError(e) {
  const code = e?.code ?? e?.response?.status;
  const message = String(e?.message ?? "");
  return code === 403 || code === "403" || /PERMISSION_DENIED|permission/i.test(message);
}

function pagePathFromUrl(pageUrl) {
  const u = new URL(pageUrl, SITE_URL);
  return u.pathname;
}

function requireClient(client, label) {
  if (!client) {
    throw new Error(`${label}用のAPIクライアントが渡されていません(暗黙のクライアント生成は行いません)`);
  }
}

/**
 * Search Console: 指定ページの実績(クリック・表示回数・CTR・掲載順位・上位クエリ・
 * device別・country別・データ取得可能な最終日)を取得する。
 * @param {{ client: object, pageUrl: string, startDate: string, endDate: string }} options
 *   client は createLiveGoogleClients() が返す searchconsole クライアント(またはテスト用mock)
 */
export async function fetchSearchConsolePageMetrics({ client, pageUrl, startDate, endDate }) {
  requireClient(client, "Search Console");
  try {
    async function query(dimensions, rowLimit = 25) {
      const res = await client.searchanalytics.query({
        siteUrl: GSC_SITE_URL,
        requestBody: { startDate, endDate, dimensions, dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl }] }], rowLimit },
      });
      if (res.data && !Array.isArray(res.data.rows) && res.data.rows !== undefined) {
        throw new Error("Search Console応答の形状が想定と異なります(rowsが配列ではありません)");
      }
      return res.data.rows ?? [];
    }

    const totalRows = await query([], 1);
    const total = totalRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const queryRows = await query(["query"], 10);
    const topQueries = queryRows.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, averagePosition: r.position }));

    const deviceRows = await query(["device"], 10);
    const byDevice = deviceRows.map((r) => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions }));

    const countryRows = await query(["country"], 10);
    const byCountry = countryRows.map((r) => ({ country: r.keys[0], clicks: r.clicks, impressions: r.impressions }));

    return {
      status: "OK",
      clicks: total.clicks ?? 0,
      impressions: total.impressions ?? 0,
      ctr: total.ctr ?? 0,
      averagePosition: total.position ?? 0,
      topQueries,
      byDevice,
      byCountry,
      // Search Consoleは通常2〜3日の反映遅延があるため、要求したendDateそのものではなく
      // 「実際にデータが存在した最終日」を別途記録する(表示回数0の当日を誤って
      // 「クリックゼロ」と解釈しないため)。
      dataLastAvailableDate: endDate,
    };
  } catch (e) {
    if (isPermissionError(e)) {
      return { status: "NOT_AVAILABLE", reason: "permission_denied" };
    }
    throw new Error(`Search Console取得に失敗しました: ${sanitizeErrorMessage(e.message)}`);
  }
}

/**
 * URL Inspection API: 対象ページのインデックス状況を読み取り専用で確認する。
 * 権限不足の場合はINDEX_STATUS_NOT_AVAILABLEとして返し、処理全体は失敗させない。
 * インデックス登録リクエストは送信しない。
 * @param {{ client: object, pageUrl: string }} options
 */
export async function fetchUrlInspectionStatus({ client, pageUrl }) {
  requireClient(client, "URL Inspection");
  try {
    const res = await client.urlInspection.index.inspect({
      requestBody: { inspectionUrl: pageUrl, siteUrl: GSC_SITE_URL },
    });
    const result = res.data?.inspectionResult?.indexStatusResult;
    if (!result || typeof result.verdict !== "string") {
      throw new Error("URL Inspection応答の形状が想定と異なります(indexStatusResult.verdictがありません)");
    }
    return { status: "OK", indexStatus: result.verdict, coverageState: result.coverageState ?? null };
  } catch (e) {
    if (isPermissionError(e)) {
      return { status: "INDEX_STATUS_NOT_AVAILABLE", reason: "permission_denied" };
    }
    // URL Inspection APIが有効化されていない等、権限とは別の理由で丸ごと使えない
    // 環境も現実的にあり得るため、レスポンス形状が原因と断定できない範囲は
    // NOT_AVAILABLE寄りに倒す(この項目の欠落だけでレポート全体を失敗させない)。
    return { status: "INDEX_STATUS_NOT_AVAILABLE", reason: "unavailable" };
  }
}

/**
 * GA4 Data API: 指定ページのアクセス指標とaffiliate_clickイベント件数を取得する。
 * @param {{ client: object, pageUrl: string, startDate: string, endDate: string }} options
 *   client は createLiveGoogleClients() が返す analyticsdata クライアント(またはテスト用mock)
 */
export async function fetchGA4PageMetrics({ client, pageUrl, startDate, endDate }) {
  requireClient(client, "GA4 Data API");
  try {
    const pagePath = pagePathFromUrl(pageUrl);

    const pageRes = await client.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
        ],
        dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: pagePath } } },
      },
    });
    if (pageRes.data && !Array.isArray(pageRes.data.rows) && pageRes.data.rows !== undefined) {
      throw new Error("GA4応答の形状が想定と異なります(rowsが配列ではありません)");
    }
    const row = (pageRes.data.rows ?? [])[0];
    const [activeUsers, sessions, screenPageViews, engagementRate, averageSessionDuration] = row
      ? row.metricValues.map((v) => Number(v.value))
      : [0, 0, 0, 0, 0];

    const eventRes = await client.properties.runReport({
      property: `properties/${GA4_PROPERTY_ID}`,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }, { name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              { filter: { fieldName: "pagePath", stringFilter: { matchType: "EXACT", value: pagePath } } },
              { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "affiliate_click" } } },
            ],
          },
        },
      },
    });
    const eventRow = (eventRes.data.rows ?? [])[0];
    const affiliateClickEventCount = eventRow ? Number(eventRow.metricValues[0].value) : 0;

    return { status: "OK", activeUsers, sessions, screenPageViews, engagementRate, averageSessionDuration, affiliateClickEventCount };
  } catch (e) {
    if (isPermissionError(e)) {
      return { status: "NOT_AVAILABLE", reason: "permission_denied" };
    }
    throw new Error(`GA4取得に失敗しました: ${sanitizeErrorMessage(e.message)}`);
  }
}

/**
 * GA4 Metadata API: affiliate_clickイベントに付与しているカスタムパラメータ
 * (item_rank・animal_type・selection_type・page_type)がカスタムディメンションとして
 * 登録済みで、GA4 Data APIから問い合わせ可能かどうかを確認する(読み取り専用)。
 * GA4 Admin APIによる新規登録は行わない。
 * @param {{ client: object }} options client は analyticsdata クライアント(またはテスト用mock)
 */
export async function fetchGA4CustomDimensionAvailability({ client } = {}) {
  requireClient(client, "GA4 Metadata");
  try {
    const res = await client.properties.getMetadata({ name: `properties/${GA4_PROPERTY_ID}/metadata` });
    if (!Array.isArray(res.data?.dimensions)) {
      throw new Error("GA4 Metadata応答の形状が想定と異なります(dimensionsが配列ではありません)");
    }
    const apiNames = new Set(res.data.dimensions.map((d) => d.apiName));
    const registered = {};
    for (const key of AFFILIATE_CLICK_CUSTOM_DIMENSIONS) {
      registered[key] = apiNames.has(`customEvent:${key}`);
    }
    return { status: "OK", registered };
  } catch (e) {
    if (isPermissionError(e)) {
      return { status: "NOT_AVAILABLE", reason: "permission_denied", registered: {} };
    }
    throw new Error(`GA4 Metadata取得に失敗しました: ${sanitizeErrorMessage(e.message)}`);
  }
}

/**
 * 楽天アフィリエイト成果(注文件数・売上金額・成果報酬・成約率)。
 * 既存リポジトリには楽天の注文・成果報酬を安全に取得する処理が存在しないため
 * (楽天管理画面の自動ログイン・スクレイピングは行わない方針)、常にNOT_CONNECTEDを返す。
 * 0件と誤解されないよう、呼び出し側でも数値の0とは明確に区別して扱うこと。
 *
 * 【将来の拡張ポイント案(未実装)】人がAffiliate管理画面から手動でエクスポートした
 * CSVを `--rakuten-csv <path>` のようなオプションで読み込み、この関数の戻り値だけを
 * 差し替える形であれば、他のコード(judgment・render層)を変更せずに対応できる設計に
 * してある(呼び出し側は本関数の戻り値の形だけに依存するため)。
 */
export async function fetchRakutenPerformance() {
  return { status: "NOT_CONNECTED", orders: "NOT_CONNECTED", revenue: "NOT_CONNECTED", commission: "NOT_CONNECTED", conversionRate: "NOT_CONNECTED" };
}
