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
 * @property {number} webCompetitionGap
 * @property {number} trendAndStability
 * @property {number} rakutenSupplyFit
 * @property {number} clusterFit
 * @property {number} total
 * @property {'LOW'|'MEDIUM'|'HIGH'} confidence
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
