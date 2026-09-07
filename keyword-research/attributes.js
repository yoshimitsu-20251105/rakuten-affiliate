// キーワードを属性(動物種・ライフステージ・商品種別・特徴・購入条件)へ分解する。
// 楽天商品照合層(rakuten-match.js)とクラスター分類(cluster.js)の両方から使う共通ロジック。

const ATTRIBUTE_DICTIONARY = [
  { tag: "species:dog", tokens: ["犬", "ドッグ", "わんこ"] },
  { tag: "species:cat", tokens: ["猫", "キャット", "ねこ"] },
  { tag: "lifeStage:puppy", tokens: ["子犬", "パピー"] },
  { tag: "lifeStage:kitten", tokens: ["子猫", "キトン"] },
  { tag: "lifeStage:senior", tokens: ["シニア", "老犬", "老猫", "高齢"] },
  { tag: "lifeStage:adult", tokens: ["成犬", "成猫"] },
  { tag: "productType:staple", tokens: ["主食", "フード", "ドッグフード", "キャットフード"] },
  { tag: "productType:treat", tokens: ["おやつ", "トリーツ", "スナック", "ジャーキー", "ガム"] },
  { tag: "productType:dry", tokens: ["ドライ"] },
  { tag: "productType:wet", tokens: ["ウェット", "缶詰"] },
  { tag: "feature:domestic", tokens: ["国産", "日本製", "日本産"] },
  { tag: "feature:additive-free", tokens: ["無添加"] },
  { tag: "feature:grain-free", tokens: ["グレインフリー", "穀物不使用"] },
  { tag: "feature:small-bite", tokens: ["小粒"] },
  { tag: "purchaseCondition:small-pack", tokens: ["小分け", "少量", "お試し"] },
  { tag: "purchaseCondition:bulk", tokens: ["まとめ買い", "大容量"] },
  { tag: "purchaseCondition:free-shipping", tokens: ["送料無料"] },
  // 【2026-09-07 Phase 3B対応】公開ページの必須主原料判定(豚肉ドッグフードページ)に使用。
  { tag: "ingredient:pork", tokens: ["豚肉", "ポーク", "豚"] },
];

// 属性タグ → 表示用日本語ラベル(2026-09-07 Phase 3B対応で共通化)。
// pilot-draft-build.js(Phase 3A)・publication-preview-build.js(Phase 3B)の両方から
// 参照する(表示ラベルの二重管理を避けるため)。
export const ATTRIBUTE_LABELS = {
  "species:dog": "犬用",
  "species:cat": "猫用",
  "lifeStage:puppy": "子犬向け",
  "lifeStage:kitten": "子猫向け",
  "lifeStage:senior": "シニア向け",
  "lifeStage:adult": "成犬・成猫向け",
  "productType:staple": "主食",
  "productType:treat": "おやつ",
  "productType:dry": "ドライタイプ",
  "productType:wet": "ウェットタイプ",
  "feature:domestic": "国産",
  "feature:additive-free": "無添加",
  "feature:grain-free": "グレインフリー",
  "feature:small-bite": "小粒",
  "purchaseCondition:small-pack": "小分け・お試しサイズ",
  "purchaseCondition:bulk": "まとめ買い・大容量",
  "purchaseCondition:free-shipping": "送料無料",
  "ingredient:pork": "豚肉使用",
};

/**
 * @param {string} canonicalKeyword - normalizeKeyword()の出力(空白区切りトークン列)
 * @returns {string[]} 属性タグの配列(例: ["species:dog", "feature:domestic"])
 */
export function extractAttributes(canonicalKeyword) {
  const text = ` ${canonicalKeyword} `;
  const tags = new Set();
  for (const entry of ATTRIBUTE_DICTIONARY) {
    for (const token of entry.tokens) {
      if (text.includes(token)) {
        tags.add(entry.tag);
        break;
      }
    }
  }
  return [...tags];
}
