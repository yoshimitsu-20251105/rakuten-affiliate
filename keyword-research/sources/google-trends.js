// google_trendsアダプター(条件付き・既定で無効)。
//
// 【実装状況(2026-09-04監査で明確化)】
// - 実装済み: Source層共通インターフェース(関数シグネチャ・環境変数による設定検出・
//   meta情報の返却)。
// - 未実装: 実際のHTTPリクエスト(API呼び出し)そのもの。GOOGLE_TRENDS_API_ENDPOINTを
//   設定してもデータは1件も返らない(観測データは常に空配列)。
// これは「アダプターまで実装済み」ではなく「インターフェースのみ実装」の状態である。
// 正式なGoogle Trends APIの利用契約(スコープ・エンドポイント仕様)がプロジェクトごとに
// 異なり、契約が確定していない現時点では呼び出し実装を書いても検証できないため。
// 非公式スクレイピングでは代替しない(仕様3.2章)。
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
        note: "認証情報未設定のため無効(既定でOFF)。なお設定してもAPI呼び出し自体が未実装のため観測データは返らない(下記参照)。",
      },
    };
  }
  return {
    observations: [],
    meta: {
      source: "google_trends",
      configured: true,
      fallbackUsed: false,
      note:
        "GOOGLE_TRENDS_API_ENDPOINTは設定されていますが、実際のAPI呼び出しロジックは未実装です" +
        "(インターフェースのみ実装、アダプター本体は未実装。本番接続未確認)。",
    },
  };
}
