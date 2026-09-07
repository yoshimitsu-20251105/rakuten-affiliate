// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 商品・店舗の偏り防止(2026-09-07対応)。
//
// 上位表示商品が同一店舗・同一シリーズ(実質同じ商品のバリエーション)に偏ると、
// 「おすすめランキング」としての情報価値が下がるため、決定的でテスト可能な
// ルールで検出する。判定はitemName(内部データ)のみを使い、公開HTMLへは出力しない。

export const MAX_ITEMS_PER_SHOP = 2;
export const MIN_DISTINCT_SHOPS = 3;
export const SAME_SERIES_SIMILARITY_THRESHOLD = 0.6;
export const MAX_SAME_SERIES_GROUP_SIZE = 2; // これを超える(3件以上)と拒否対象

function toBigrams(text) {
  const s = String(text ?? "");
  const bigrams = new Set();
  for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2));
  return bigrams;
}

/**
 * 2つの商品名の類似度(Jaccard係数、文字2-gramベース)を0〜1で返す決定的な関数。
 * 外部ライブラリ・乱数・ロケール依存を使わないため、常に同じ入力から同じ結果になる。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function computeNameSimilarity(a, b) {
  const setA = toBigrams(a);
  const setB = toBigrams(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const bg of setA) if (setB.has(bg)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 商品配列の店舗多様性を評価する。
 * @param {Array<{ itemCode: string, shopName?: string }>} items
 * @returns {{
 *   distinctShopCount: number, shopCounts: Record<string, number>,
 *   exceedsMaxPerShop: boolean, overLimitShops: string[], meetsMinDistinctShops: boolean,
 * }}
 */
export function evaluateShopDiversity(items) {
  const shopCounts = {};
  for (const item of items) {
    const shop = item.shopName ?? "(不明)";
    shopCounts[shop] = (shopCounts[shop] ?? 0) + 1;
  }
  const overLimitShops = Object.entries(shopCounts)
    .filter(([, count]) => count > MAX_ITEMS_PER_SHOP)
    .map(([shop]) => shop);
  const distinctShopCount = Object.keys(shopCounts).length;
  return {
    distinctShopCount,
    shopCounts,
    exceedsMaxPerShop: overLimitShops.length > 0,
    overLimitShops,
    meetsMinDistinctShops: distinctShopCount >= MIN_DISTINCT_SHOPS,
  };
}

/**
 * 商品名の類似度に基づき、同一シリーズとみなせるグループへ分割する(Union-Find)。
 * 単独(グループサイズ1)の商品は結果に含まない。
 * @param {Array<{ itemCode: string, itemName?: string }>} items
 * @param {number} threshold
 * @returns {Array<Array<{ itemCode: string, itemName?: string }>>}
 */
export function findSameSeriesGroups(items, threshold = SAME_SERIES_SIMILARITY_THRESHOLD) {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (computeNameSimilarity(items[i].itemName, items[j].itemName) >= threshold) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(items[i]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/**
 * 同一シリーズが最大許容件数を超えて並んでいるか(=自動生成拒否対象か)を判定する。
 * @param {Array<{ itemCode: string, itemName?: string }>} items
 * @returns {boolean}
 */
export function hasExcessiveSameSeriesGroup(items, threshold = SAME_SERIES_SIMILARITY_THRESHOLD, maxAllowed = MAX_SAME_SERIES_GROUP_SIZE) {
  return findSameSeriesGroups(items, threshold).some((g) => g.length > maxAllowed);
}
