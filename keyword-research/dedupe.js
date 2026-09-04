// カニバリゼーション防止(9章)。
// normalizeKeyword()はトークンをソートしたcanonicalKeywordを返すため、
// 「国産 無添加 ドッグフード」「ドッグフード 無添加 国産」のような語順違いは
// 自動的に同じcanonicalKeywordへ集約される。ここではcanonicalKeyword単位で
// 観測データをグルーピングし、統合理由をログへ残す。
//
// 一方、シニア犬向け/子犬向け/小型犬向けのように対象・条件が異なる語は、
// 属性抽出(attributes.js)の時点で異なるトークンを持つため、異なるcanonicalKeywordに
// なり、自動的に分離されたまま残る(意図的にここでは統合しない)。

/**
 * @param {Array<{ canonicalKeyword: string, aliases: string[], observation: import('./types.js').KeywordObservation }>} normalized
 */
export function groupByCanonicalKeyword(normalized) {
  const groups = new Map();
  for (const entry of normalized) {
    const key = entry.canonicalKeyword;
    if (!groups.has(key)) {
      groups.set(key, {
        canonicalKeyword: key,
        aliases: new Set(),
        observations: [],
      });
    }
    const group = groups.get(key);
    for (const alias of entry.aliases) group.aliases.add(alias);
    group.observations.push(entry.observation);
  }

  return [...groups.values()].map((g) => ({
    canonicalKeyword: g.canonicalKeyword,
    aliases: [...g.aliases],
    mergedObservation: mergeObservations(g.observations),
    variantCount: g.observations.length,
    mergeReason:
      g.observations.length > 1
        ? `語順違い等の表記揺れ${g.observations.length}件を統合(${g.aliases.size}種類の表記)`
        : "統合対象なし(単一表記)",
  }));
}

function mergeObservations(observations) {
  // 最新の観測を基本形にしつつ、数値指標は「複数ソース/表記の合算」として monthlySearches
  // は合計、その他の指標(競合度・trendIndex等)は最初に値が取れたものを採用する。
  const base = { ...observations[0] };
  let monthlySearchesSum;
  let anyDefined = false;
  for (const obs of observations) {
    if (typeof obs.monthlySearches === "number") {
      monthlySearchesSum = (monthlySearchesSum ?? 0) + obs.monthlySearches;
      anyDefined = true;
    }
    for (const field of ["competitionLevel", "competitionIndex", "trendIndex", "impressions", "clicks", "ctr", "averagePosition"]) {
      if (base[field] === undefined && obs[field] !== undefined) base[field] = obs[field];
    }
  }
  base.monthlySearches = anyDefined ? monthlySearchesSum : undefined;
  return base;
}
