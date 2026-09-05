// カニバリゼーション防止(9章)。
// normalizeKeyword()はトークンをソートしたcanonicalKeywordを返すため、
// 「国産 無添加 ドッグフード」「ドッグフード 無添加 国産」のような語順違いは
// 自動的に同じcanonicalKeywordへ集約される。ここではcanonicalKeyword単位で
// 観測データをグルーピングし、統合理由をログへ残す。
//
// 一方、シニア犬向け/子犬向け/小型犬向けのように対象・条件が異なる語は、
// 属性抽出(attributes.js)の時点で異なるトークンを持つため、異なるcanonicalKeywordに
// なり、自動的に分離されたまま残る(意図的にここでは統合しない)。
//
// 【2026-09-05 GKP実データ監査対応】monthlySearchesの二重計上防止。
// Googleキーワードプランナーは近似語・語順違いに同一または重複した検索ボリュームを
// 割り当てることがあるため、単純合算すると需要を過大評価してしまう。合算ではなく
// 「最大値を代表値にする」方式へ変更し、元の各値はsourceObservationsに保持する。

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
  // 最新の観測を基本形にしつつ、数値指標は複数ソース/表記の代表値をmonthlySearches
  // (最大値、二重計上防止のため合算しない)、その他の指標(競合度・trendIndex等)は
  // 最初に値が取れたものを採用する。
  const base = { ...observations[0] };
  const numericSearches = observations
    .map((o) => o.monthlySearches)
    .filter((v) => typeof v === "number");

  if (numericSearches.length > 0) {
    base.monthlySearches = Math.max(...numericSearches);
    const distinctValues = [...new Set(numericSearches)];
    if (distinctValues.length > 1) {
      // 表記違いの各行に異なる検索ボリュームが割り当てられていた場合、その旨を記録する
      // (需要スコアの計算には使わない。人間の確認・レポート表示のためだけの情報)
      base.searchVolumeVariance = {
        values: distinctValues,
        max: Math.max(...distinctValues),
        min: Math.min(...distinctValues),
      };
    }
  } else {
    base.monthlySearches = undefined;
  }

  for (const obs of observations) {
    for (const field of ["competitionLevel", "competitionIndex", "trendIndex", "impressions", "clicks", "ctr", "averagePosition"]) {
      if (base[field] === undefined && obs[field] !== undefined) base[field] = obs[field];
    }
  }

  // 統合前の各観測(originalKeyword個別)を保持する。需要スコアには使わず、
  // レポート・監査のためだけに残す。
  base.sourceObservations = observations;
  return base;
}
