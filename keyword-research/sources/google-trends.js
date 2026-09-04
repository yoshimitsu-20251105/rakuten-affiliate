// google_trendsアダプター(条件付き・既定で無効)。
// 正式なAPI利用権限と認証が確認できた場合のみ有効化する。非公式スクレイピングでは代替しない。
// Trendsの0〜100は絶対検索数ではないため trendIndex(相対値)として保持し、monthlySearchesには入れない。

function isConfigured() {
  return Boolean(process.env.GOOGLE_TRENDS_API_KEY && process.env.GOOGLE_TRENDS_API_ENDPOINT);
}

/**
 * @param {string[]} seedKeywords
 * @returns {Promise<import('./index.js').SourceResult>}
 */
export async function fetchFromGoogleTrends(seedKeywords) {
  if (!isConfigured()) {
    return {
      observations: [],
      meta: {
        source: "google_trends",
        configured: false,
        fallbackUsed: false,
        note: "正式なGoogle Trends APIの認証情報が未設定のため無効(既定でOFF、非公式スクレイピングは行わない)",
      },
    };
  }
  // 正式APIの契約内容がプロジェクトごとに異なるため、endpoint呼び出しは利用契約確定後に実装する。
  return {
    observations: [],
    meta: {
      source: "google_trends",
      configured: true,
      fallbackUsed: false,
      note: "GOOGLE_TRENDS_API_ENDPOINT は設定されていますが、契約内容に応じた呼び出し実装は未実装です(本番接続未確認)。",
    },
  };
}
