// キーワード正規化層。
// Unicode正規化・全角半角空白統一・連続空白削除・大文字小文字統一・記号統一・
// 語順違いの同義集約・限定的な同義語辞書を行う。
// 高度なブランド正規化や根拠のない同義語統合は行わない。異なる検索意図の語を
// 機械的にまとめない(この関数は表記揺れの吸収のみを行う)。
//
// 【2026-09-05 GKP実データ監査対応】複合語の分割語正規化(例:「無 添加」→「無添加」)を
// 語順ソートより前に追加した。config.compoundTokenMergesの隣接トークンペアだけを
// 限定的に統合し、無関係な文字列は結合しない。originalKeyword(入力そのまま)は
// 一切書き換えない。

/**
 * @param {string} raw
 * @param {{synonyms?: Record<string,string[]>, compoundTokenMerges?: Array<{tokens:[string,string], joined:string}>}} config
 * @returns {{ canonicalKeyword: string, aliases: string[], original: string, originalKeyword: string }}
 */
export function normalizeKeyword(raw, config = {}) {
  const original = String(raw ?? "");
  const synonyms = config.synonyms ?? {};
  const compoundTokenMerges = config.compoundTokenMerges ?? [];

  let s = original.normalize("NFKC"); // Unicode正規化(全角英数記号 → 半角化を含む)
  s = s.replace(/[　\s]+/g, " ").trim(); // 全角/半角空白の統一+連続空白削除
  s = s.toLowerCase();
  // 明らかな記号差の統一(中黒・波ダッシュ・長音の揺れ等、意味を変えない範囲のみ)
  s = s.replace(/[・･]/g, " ").replace(/[〜~]/g, "").replace(/\s+/g, " ").trim();

  let tokens = s.split(" ").filter(Boolean);

  // 複合語の分割語正規化(語順ソートより前、同義語辞書適用より前に行う)
  tokens = mergeCompoundTokens(tokens, compoundTokenMerges);

  // 同義語辞書による表記統一(辞書のキーへ寄せる)
  const synonymMap = buildSynonymLookup(synonyms);
  tokens = tokens.map((t) => synonymMap.get(t) ?? t);

  // 語順だけが違う候補を集約するための正規化キー(トークンをソート)
  const sortedTokens = [...tokens].sort();
  const canonicalKeyword = sortedTokens.join(" ");

  return {
    canonicalKeyword,
    aliases: [original, tokens.join(" ")].filter((v, i, arr) => arr.indexOf(v) === i),
    original,
    originalKeyword: original, // originalの明示的な別名(このプロジェクトの用語に合わせる)
  };
}

// トークンのペアを辞書引き用のキー文字列にする(半角スペース区切り)。
function pairKey(a, b) {
  return [a, b].join(" ");
}

/**
 * 隣接するトークンのペアが分割語辞書に完全一致する場合だけ1トークンへ統合する。
 * 左から一度スキャンし、一致したペアは統合結果に置き換えて読み進める(貪欲・単純な
 * 1パス走査で十分。限定的な小辞書のみを対象とするため)。
 */
function mergeCompoundTokens(tokens, merges) {
  if (merges.length === 0) return tokens;
  const pairMap = new Map(merges.map((m) => [pairKey(m.tokens[0], m.tokens[1]), m.joined]));
  const result = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i < tokens.length - 1) {
      const key = pairKey(tokens[i], tokens[i + 1]);
      if (pairMap.has(key)) {
        result.push(pairMap.get(key));
        i++; // ペアの2つ目を消費する
        continue;
      }
    }
    result.push(tokens[i]);
  }
  return result;
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
