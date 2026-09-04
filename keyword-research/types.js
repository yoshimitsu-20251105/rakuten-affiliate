// Web商品需要リサーチ機能の共有型定義(JSDoc)。
// このプロジェクトはTypeScriptを使わないため、実行コードは持たず、
// 各モジュールから `@typedef {import('./types.js').X} X` の形で参照するための
// ドキュメント専用ファイル。

/**
 * @typedef {'manual_csv'|'fixture'|'google_ads'|'search_console'|'google_trends'} KeywordSourceName
 */

/**
 * @typedef {Object} KeywordObservation
 * @property {KeywordSourceName} source
 * @property {string} [sourceProvider] - データの実際の出所('google_ads_api'|'search_console_api'|
 *   'google_keyword_planner'|'fixture'|'unknown'等)。businessValidated判定に使う。未指定は'unknown'扱い
 * @property {boolean} [isSynthetic] - 推定値・テスト値・再現用の固定データならtrue(businessValidatedは常にfalse)
 * @property {string} keyword
 * @property {string} observedAt - ISO8601
 * @property {string} [periodStart]
 * @property {string} [periodEnd]
 * @property {string} [country]
 * @property {string} [language]
 * @property {number|undefined} [monthlySearches]
 * @property {Array<{month: string, volume: number}>|undefined} [monthlyVolumes]
 * @property {'LOW'|'MEDIUM'|'HIGH'|'UNKNOWN'|undefined} [competitionLevel]
 * @property {number|undefined} [competitionIndex]
 * @property {number|undefined} [lowTopOfPageBid]
 * @property {number|undefined} [highTopOfPageBid]
 * @property {number|undefined} [impressions]
 * @property {number|undefined} [clicks]
 * @property {number|undefined} [ctr]
 * @property {number|undefined} [averagePosition]
 * @property {number|undefined} [trendIndex]
 * @property {string|undefined} [rawReference]
 */

/**
 * @typedef {'EXACT_PRODUCT'|'CONDITION_PURCHASE'|'COMMERCIAL_COMPARISON'|'PROBLEM_SOLUTION'|'INFORMATIONAL'|'MEDICAL_REVIEW_REQUIRED'} SearchIntent
 */

/**
 * @typedef {Object} KeywordScoreBreakdown
 * @property {number} demand
 * @property {number} purchaseIntent
 * @property {number} adsCompetitionGap - Google Ads入札競合の代理指標(自然検索SEO競合ではない)
 * @property {number} trendAndStability
 * @property {number} rakutenSupplyFit
 * @property {number} clusterFit
 * @property {number} total
 * @property {'LOW'|'MEDIUM'|'HIGH'} confidence
 * @property {boolean} businessValidated - 実データ(fixtureでも欠損でもない)で裏付けられているか
 * @property {string} dataSource - 元観測データのsource('fixture'を含む)
 * @property {string[]} reasons
 */

/**
 * @typedef {'ELIGIBLE'|'NEEDS_MANUAL_REVIEW'|'REJECTED'} MatchStatus
 */

/**
 * @typedef {Object} KeywordProductMatch
 * @property {string} canonicalKeyword
 * @property {string} itemCode
 * @property {string[]} requiredAttributes
 * @property {string[]} matchedAttributes
 * @property {string[]} missingAttributes
 * @property {string[]} conflictingAttributes
 * @property {number} matchScore
 * @property {MatchStatus} status
 * @property {string[]} reasons
 */

export {};
