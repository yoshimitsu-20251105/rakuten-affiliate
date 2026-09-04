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
  { tag: "productType:treat", tokens: ["おやつ", "トリーツ", "スナック"] },
  { tag: "productType:dry", tokens: ["ドライ"] },
  { tag: "productType:wet", tokens: ["ウェット", "缶詰"] },
  { tag: "feature:domestic", tokens: ["国産", "日本製", "日本産"] },
  { tag: "feature:additive-free", tokens: ["無添加"] },
  { tag: "feature:grain-free", tokens: ["グレインフリー", "穀物不使用"] },
  { tag: "feature:small-bite", tokens: ["小粒"] },
  { tag: "purchaseCondition:small-pack", tokens: ["小分け", "少量", "お試し"] },
  { tag: "purchaseCondition:bulk", tokens: ["まとめ買い", "大容量"] },
  { tag: "purchaseCondition:free-shipping", tokens: ["送料無料"] },
];

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
