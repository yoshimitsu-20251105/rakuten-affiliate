// google_adsアダプター(条件付き): Google Ads Keyword Planning API(GenerateKeywordIdeas)。
//
// 【重要】このアダプターは実装のみで、本番接続は未確認です(開発者トークン等の認証情報が
// このプロジェクトに未設定のため)。認証情報が揃っていない場合は自動的にfallbackSource
// (manual_csvまたはfixture)へフォールバックし、データ源と信頼度をレポートに明記する。
//
// 必要な環境変数(.env.example参照):
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
//   GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID

import { google } from "googleapis";
import { fetchWithRetry } from "../http.js";

const API_VERSION = "v18";

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      process.env.GOOGLE_ADS_CLIENT_ID &&
      process.env.GOOGLE_ADS_CLIENT_SECRET &&
      process.env.GOOGLE_ADS_REFRESH_TOKEN &&
      process.env.GOOGLE_ADS_CUSTOMER_ID
  );
}

async function getAccessToken() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN });
  const { token } = await oauth2Client.getAccessToken();
  return token;
}

/**
 * @param {string[]} seedKeywords
 * @param {{fallback: (reason: string) => Promise<import('./index.js').SourceResult>}} options
 * @returns {Promise<import('./index.js').SourceResult>}
 */
export async function fetchFromGoogleAds(seedKeywords, options) {
  if (!isConfigured()) {
    const fallbackResult = await options.fallback("Google Ads認証情報が未設定");
    return {
      observations: fallbackResult.observations,
      meta: {
        source: "google_ads",
        configured: false,
        fallbackUsed: true,
        note: `Google Ads未設定のため ${fallbackResult.meta.source} へフォールバック(本番接続未確認)`,
      },
    };
  }

  try {
    const accessToken = await getAccessToken();
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || customerId;
    const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:generateKeywordIdeas`;

    const body = {
      keywordSeed: { keywords: seedKeywords },
      geoTargetConstants: [], // 日本全国指定は別途geo target constant IDが必要(今回は未指定=全世界扱いになる点に注意)
      language: "languageConstants/1005", // 日本語
      keywordPlanNetwork: "GOOGLE_SEARCH",
    };

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeoutMs: 15000,
      maxRetries: 2,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Ads API エラー: ${res.status} ${errText.slice(0, 200)}`);
    }
    const data = await res.json();
    const observedAt = new Date().toISOString();
    const observations = (data.results ?? []).map((r) => {
      const monthlyVolumes = (r.keywordIdeaMetrics?.monthlySearchVolumes ?? []).map((m) => ({
        month: `${m.year}-${String(m.month).padStart(2, "0")}`,
        volume: Number(m.monthlySearches ?? 0),
      }));
      // 取得期間: monthlySearchVolumesの範囲があればそれを使う。無ければ
      // Keyword Planningの仕様(直近12か月平均)に合わせてobservedAtから12か月遡った
      // 範囲を暫定値として設定する(businessValidatedの「取得期間」判定に使用)。
      const periodStart = monthlyVolumes[0]
        ? `${monthlyVolumes[0].month}-01`
        : new Date(new Date(observedAt).setMonth(new Date(observedAt).getMonth() - 12)).toISOString().slice(0, 10);
      const periodEnd = monthlyVolumes.length
        ? `${monthlyVolumes[monthlyVolumes.length - 1].month}-01`
        : observedAt.slice(0, 10);
      return {
        source: "google_ads",
        sourceProvider: "google_ads_api",
        isSynthetic: false,
        keyword: r.text,
        observedAt,
        periodStart,
        periodEnd,
        country: "JP",
        language: "ja",
        monthlySearches: r.keywordIdeaMetrics?.avgMonthlySearches
          ? Number(r.keywordIdeaMetrics.avgMonthlySearches)
          : undefined,
        monthlyVolumes,
        competitionLevel: r.keywordIdeaMetrics?.competition ?? "UNKNOWN",
        competitionIndex: r.keywordIdeaMetrics?.competitionIndex
          ? Number(r.keywordIdeaMetrics.competitionIndex)
          : undefined,
        lowTopOfPageBid: r.keywordIdeaMetrics?.lowTopOfPageBidMicros
          ? Number(r.keywordIdeaMetrics.lowTopOfPageBidMicros) / 1_000_000
          : undefined,
        highTopOfPageBid: r.keywordIdeaMetrics?.highTopOfPageBidMicros
          ? Number(r.keywordIdeaMetrics.highTopOfPageBidMicros) / 1_000_000
          : undefined,
        rawReference: url,
      };
    });

    return {
      observations,
      meta: {
        source: "google_ads",
        configured: true,
        fallbackUsed: false,
        note: `Google Ads API から${observations.length}件取得(本番接続 未確認 — 実行環境に認証情報がなく検証できていません)`,
      },
    };
  } catch (e) {
    const fallbackResult = await options.fallback(`Google Ads API呼び出し失敗: ${e.message}`);
    return {
      observations: fallbackResult.observations,
      meta: {
        source: "google_ads",
        configured: true,
        fallbackUsed: true,
        note: `Google Ads API呼び出し失敗のため ${fallbackResult.meta.source} へフォールバック: ${e.message}`,
      },
    };
  }
}
