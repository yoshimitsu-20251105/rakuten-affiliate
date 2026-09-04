// キーワード正規化層。
// Unicode正規化・全角半角空白統一・連続空白削除・大文字小文字統一・記号統一・
// 語順違いの同義集約・限定的な同義語辞書を行う。
// 高度なブランド正規化や根拠のない同義語統合は行わない。異なる検索意図の語を
// 機械的にまとめない(この関数は表記揺れの吸収のみを行う)。

/**
 * @param {string} raw
 * @param {{synonyms?: Record<string,string[]>}} config
 * @returns {{ canonicalKeyword: string, aliases: string[], original: string }}
 */
export function normalizeKeyword(raw, config = {}) {
  const original = String(raw ?? "");
  const synonyms = config.synonyms ?? {};

  let s = original.normalize("NFKC"); // Unicode正規化(全角英数記号 → 半角化を含む)
  s = s.replace(/[　\s]+/g, " ").trim(); // 全角/半角空白の統一+連続空白削除
  s = s.toLowerCase();
  // 明らかな記号差の統一(中黒・波ダッシュ・長音の揺れ等、意味を変えない範囲のみ)
  s = s.replace(/[・･]/g, " ").replace(/[〜~]/g, "").replace(/\s+/g, " ").trim();

  // 同義語辞書による表記統一(辞書のキーへ寄せる)
  const synonymMap = buildSynonymLookup(synonyms);
  const tokens = s.split(" ").filter(Boolean).map((t) => synonymMap.get(t) ?? t);

  // 語順だけが違う候補を集約するための正規化キー(トークンをソート)
  const sortedTokens = [...tokens].sort();
  const canonicalKeyword = sortedTokens.join(" ");

  return {
    canonicalKeyword,
    aliases: [original, tokens.join(" ")].filter((v, i, arr) => arr.indexOf(v) === i),
    original,
  };
}

function buildSynonymLookup(synonymDict) {
  const map = new Map();
  for (const [canonical, variants] of Object.entries(synonymDict)) {
    const canonicalLower = canonical.normalize("NFKC").toLowerCase();
    for (const variant of variants) {
      map.set(variant.normalize("NFKC").toLowerCase(), canonicalLower);
    }
  }
  return map;
}
