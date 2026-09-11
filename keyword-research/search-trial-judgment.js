// Phase 3C(検索公開試験レポート)専用: 暫定判定ロジック(2026-09-17対応)。
//
// 【重要】ここで定義する基準は業界標準ではなく、今回の検索公開試験用に人が定めた
// 暫定基準である。レポート上でもその旨を明記すること(このモジュール自体は
// 表示文言を持たず、判定結果(該当したstatusと根拠数値)だけを返す)。
//
// データ不足(INSUFFICIENT_DATA)は失敗ではなく、複数の基準に同時に該当する場合は
// すべてを返す(1つに絞らない)。楽天成果に関する判定は、楽天成果データが実際に
// 取得できた場合(status !== "NOT_CONNECTED")のみ評価する(未接続を0件として
// 誤判定しないため)。

/**
 * @param {{
 *   searchConsole: { status: string, impressions?: number, clicks?: number },
 *   ga4: { status: string, screenPageViews?: number, affiliateClickEventCount?: number },
 *   rakuten: { status: string, orders?: number|string, commission?: number|string },
 * }} pageMetrics
 * @returns {Array<{ status: string, evidence: Record<string, number|string> }>}
 */
export function judgeSearchTrialPage({ searchConsole, ga4, rakuten }) {
  const findings = [];

  const impressions = searchConsole?.status === "OK" ? searchConsole.impressions ?? 0 : undefined;
  const searchClicks = searchConsole?.status === "OK" ? searchConsole.clicks ?? 0 : undefined;
  const screenPageViews = ga4?.status === "OK" ? ga4.screenPageViews ?? 0 : undefined;
  const affiliateClicks = ga4?.status === "OK" ? ga4.affiliateClickEventCount ?? 0 : undefined;

  if (impressions !== undefined && screenPageViews !== undefined) {
    if (impressions < 100 || screenPageViews < 20) {
      findings.push({ status: "INSUFFICIENT_DATA", evidence: { impressions, screenPageViews } });
    }
  }

  if (impressions !== undefined && searchClicks !== undefined) {
    if (impressions >= 100 && searchClicks === 0) {
      findings.push({ status: "SEARCH_SNIPPET_REVIEW", evidence: { impressions, searchClicks } });
    }
  }

  if (screenPageViews !== undefined && affiliateClicks !== undefined) {
    if (screenPageViews >= 20 && affiliateClicks === 0) {
      findings.push({ status: "PAGE_CONVERSION_REVIEW", evidence: { screenPageViews, affiliateClicks } });
    }
  }

  const rakutenAvailable = rakuten?.status !== "NOT_CONNECTED" && rakuten?.status !== undefined;
  if (rakutenAvailable && affiliateClicks !== undefined) {
    const orders = typeof rakuten.orders === "number" ? rakuten.orders : undefined;
    if (affiliateClicks >= 10 && orders === 0) {
      findings.push({ status: "PRODUCT_OFFER_REVIEW", evidence: { affiliateClicks, orders } });
    }
  }
  if (rakutenAvailable) {
    const commission = typeof rakuten.commission === "number" ? rakuten.commission : undefined;
    if (commission !== undefined && commission >= 1) {
      findings.push({ status: "MONETIZATION_SIGNAL_DETECTED", evidence: { commission } });
    }
  }

  return findings;
}
