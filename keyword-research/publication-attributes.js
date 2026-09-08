// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 公開ページ単位の必須属性定義(2026-09-07対応)。
//
// Phase 3Aのキーワード必須属性(requiredAttributes、rakuten-matches.csv由来)は
// 「犬用・シニア」中心であり、公開タイトルが要求する「豚肉・主食」までは固定していない。
// Phase 3Bでは公開ページごとに、より厳格な必須属性集合を明示する。
// 対象は今回のPhase 3B対象2ページに限定する(汎用フレームワーク化は対象外)。

export const PUBLICATION_PAGE_REQUIREMENTS = {
  "senior-dog-pork": {
    normalizedKeyword: "シニア 犬 豚肉",
    requiredAttributes: ["species:dog", "lifeStage:senior", "productType:staple", "ingredient:pork"],
  },
  "grain-free-cat-food": {
    normalizedKeyword: "キャットフード グレインフリー",
    requiredAttributes: ["species:cat", "productType:staple", "feature:grain-free"],
  },
};

const SELECTABLE_FLAVOR_PHRASES = ["選べる", "よりどり", "選択可"];
const PROTEIN_FLAVOR_TOKENS = ["豚肉", "ポーク", "鶏肉", "チキン", "牛肉", "ビーフ", "馬肉", "ホース", "魚", "フィッシュ", "サーモン"];

/**
 * 「複数種類のフレーバー(タンパク源)から選べる」商品かどうかを、itemNameのテキスト
 * パターンから機械的に判定する(seller文言をそのまま転記せず、固定の注意文を
 * 表示するかどうかの判定材料としてのみ使う)。
 * @param {string} itemName
 * @returns {boolean}
 */
export function needsFlavorSelectionNote(itemName) {
  const s = String(itemName ?? "");
  const hasSelectablePhrase = SELECTABLE_FLAVOR_PHRASES.some((p) => s.includes(p));
  if (!hasSelectablePhrase) return false;
  const proteinTokenCount = PROTEIN_FLAVOR_TOKENS.filter((p) => s.includes(p)).length;
  return proteinTokenCount >= 2;
}

export const FLAVOR_SELECTION_NOTE_TEXT = "購入時に豚肉タイプを選択してください";
