// Keyword Source層の共通インターフェース。
// 各アダプターは fetchObservations(seedKeywords, options) => Promise<{observations, meta}> を実装する。
// meta には source, 使用したデータ源, 信頼度に関わる情報を含め、レポートに明記できるようにする。

/**
 * @typedef {Object} SourceResult
 * @property {import('../types.js').KeywordObservation[]} observations
 * @property {{ source: string, configured: boolean, fallbackUsed: boolean, note: string }} meta
 */

export const REQUIRED_ADAPTERS = ["manual_csv", "fixture"];
export const CONDITIONAL_ADAPTERS = ["google_ads", "search_console", "google_trends"];
