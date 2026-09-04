// 6クラスターへの分類。キーワードのトークンが各クラスターの必須トークンを
// すべて含む場合に一致とみなす。複数クラスターに一致する場合は最初に定義された
// ものを優先する(設定ファイルの順序で調整可能)。

/**
 * requiredTokensの各要素は、文字列(そのトークンが含まれること)、または
 * 文字列配列(いずれか1つでも含まれればOKなORグループ、例: 犬の別表記["犬","ドッグ"])。
 *
 * @param {string} canonicalKeyword
 * @param {Array<{id:string,label:string,requiredTokens:Array<string|string[]>}>} clusters
 * @returns {{ clusterId: string|null, clusterLabel: string|null, matched: boolean }}
 */
export function classifyCluster(canonicalKeyword, clusters) {
  for (const cluster of clusters) {
    const allRequired = cluster.requiredTokens.every((token) =>
      Array.isArray(token) ? token.some((t) => canonicalKeyword.includes(t)) : canonicalKeyword.includes(token)
    );
    if (allRequired) {
      return { clusterId: cluster.id, clusterLabel: cluster.label, matched: true };
    }
  }
  return { clusterId: null, clusterLabel: null, matched: false };
}

/**
 * FinalPriorityのclusterFit配点用: クラスターに一致していれば満点、していなければ0点。
 * (今回の初期範囲は6クラスター固定のため、部分点は設けない)
 */
export function clusterFitScore(matched, maxPoints) {
  return matched ? maxPoints : 0;
}
