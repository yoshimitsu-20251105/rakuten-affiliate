// 楽天API専用クエリ(rakutenQuery)の生成(2026-09-05 GKP実データ監査対応)。
//
// 【実証済みの原因】少数の検証クエリ(シニア 犬 の 餌 / シニア 犬 餌 / 子犬 に 良い
// フード / 子犬 良い フード 等、6件)を実際に楽天商品検索APIへ送り、独立したトークンと
// して「の」「に」を含むクエリだけが100%再現して `wrong_parameter: keyword is not
// valid` になることを確認した(除去した同一クエリはすべて成功)。この事実にもとづき、
// 楽天へ渡すクエリからだけ、空白で独立した助詞トークンを限定的に除去する。
//
// 【重要】この処理はoriginalKeyword・normalizedKeyword(canonicalKeyword)を一切
// 変更しない。rakutenQueryという別フィールドとしてのみ保持し、需要データ
// (businessValidated・WebKeywordScore等)の計算には使わない。

/**
 * @param {string} searchPhrase - 楽天へ渡す元になるフレーズ(通常はoriginalKeywordの表記)
 * @param {{ rakutenQueryParticleTokens?: string[] }} config
 * @returns {{ rakutenQuery: string|null, valid: boolean, reasons: string[] }}
 */
export function buildRakutenQuery(searchPhrase, config) {
  const particles = new Set(config.rakutenQueryParticleTokens ?? []);
  const tokens = String(searchPhrase ?? "")
    .split(/[　\s]+/)
    .filter(Boolean);

  // スペースで独立したトークンが助詞一覧に完全一致する場合だけ除去する
  // (単語内の部分文字列としては絶対に除去しない。例:「のど飴」は1トークンなので対象外)
  const filtered = tokens.filter((t) => !particles.has(t));
  const rakutenQuery = filtered.join(" ").trim();

  if (rakutenQuery === "" || rakutenQuery.length <= 1) {
    return {
      rakutenQuery: null,
      valid: false,
      reasons: ["助詞除去後にクエリが空または1文字以下になり、意味を失うためAPIを呼び出さない"],
    };
  }

  return { rakutenQuery, valid: true, reasons: [] };
}
