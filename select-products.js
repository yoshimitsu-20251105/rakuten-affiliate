// 楽天APIから商品を検索し、「高利益枠」と「安定枠」の2階層で選定してJSONに保存する。
//
// 高利益枠: 単価が高く1件あたりの報酬額が大きいジャンル(成約は難しいが当たれば大きい)
// 安定枠  : 単価は低いが定期便・消耗品でリピートされやすく、アクセス・成約数を稼ぐジャンル

import { readFile, writeFile } from "node:fs/promises";

const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_SECRET;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

if (!appId || !accessKey) {
  console.error("RAKUTEN_APP_ID または RAKUTEN_SECRET が .env に設定されていません。");
  process.exit(1);
}

// 商品名・キャッチコピーにこれらの語を含むものを「リピートが多い商品」とみなす(共通)
const repeatSignalKeywords = ["リピート", "定期便", "定期コース", "殿堂入り", "累計", "毎年注文", "何度も", "サブスク"];

// ---- 階層ごとの選定条件(ここを調整) ----
const tiers = [
  {
    name: "高利益枠",
    baseKeyword: "ふるさと納税",
    subKeywords: ["肉", "海鮮"],
    minPrice: 8000,
    maxPrice: 30000,
    minReviewCount: 10,
    minReviewAverage: 4.0,
    requireRepeatSignal: true,
    pickCount: 2, // この階層から選ぶ件数
  },
  {
    name: "安定枠",
    baseKeyword: "",
    subKeywords: ["水 500ml 定期便", "サプリメント 定期便", "美容 サブスク", "食品 まとめ買い 定期便"],
    minPrice: 1000,
    maxPrice: 6000,
    minReviewCount: 20,
    minReviewAverage: 3.8,
    requireRepeatSignal: true,
    pickCount: 3, // この階層から選ぶ件数
  },
];

const hitsPerKeyword = 30;

function hasRepeatSignal(item) {
  const text = `${item.itemName} ${item.catchcopy ?? ""}`;
  return repeatSignalKeywords.some((kw) => text.includes(kw));
}

const HISTORY_FILE = new URL("./posted-history.json", import.meta.url);

async function loadHistory() {
  try {
    return new Set(JSON.parse(await readFile(HISTORY_FILE, "utf-8")));
  } catch {
    return new Set();
  }
}

async function saveHistory(itemCodes) {
  await writeFile(HISTORY_FILE, JSON.stringify([...itemCodes], null, 2));
}

async function searchItems(keyword, tier) {
  const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601");
  url.searchParams.set("applicationId", appId);
  url.searchParams.set("accessKey", accessKey);
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("minPrice", String(tier.minPrice));
  url.searchParams.set("maxPrice", String(tier.maxPrice));
  url.searchParams.set("hits", String(hitsPerKeyword));
  url.searchParams.set("sort", "-reviewCount");
  url.searchParams.set("format", "json");

  const res = await fetch(url, {
    headers: { accessKey, Authorization: `Bearer ${accessKey}` },
  });
  const data = await res.json();
  if (data.error) {
    console.error(`[${keyword}] APIエラー:`, data.error, data.error_description);
    return [];
  }
  return (data.Items ?? []).map((wrap) => wrap.Item);
}

async function pickFromTier(tier, history, seenInThisRun) {
  const candidates = [];
  for (const sub of tier.subKeywords) {
    const keyword = tier.baseKeyword ? `${tier.baseKeyword} ${sub}` : sub;
    const items = await searchItems(keyword, tier);
    for (const item of items) {
      if (history.has(item.itemCode)) continue;
      if (seenInThisRun.has(item.itemCode)) continue;
      seenInThisRun.add(item.itemCode);
      if (item.reviewCount < tier.minReviewCount) continue;
      if (item.reviewAverage < tier.minReviewAverage) continue;
      const repeatSignal = hasRepeatSignal(item);
      if (tier.requireRepeatSignal && !repeatSignal) continue;
      candidates.push({ ...item, matchedKeyword: sub, repeatSignal, tier: tier.name });
    }
  }
  candidates.sort((a, b) => b.reviewCount * b.reviewAverage - a.reviewCount * a.reviewAverage);
  return candidates.slice(0, tier.pickCount);
}

async function main() {
  const history = await loadHistory();
  const seenInThisRun = new Set();
  const picked = [];

  for (const tier of tiers) {
    const items = await pickFromTier(tier, history, seenInThisRun);
    picked.push(...items);
  }

  console.log(`選定: ${picked.length}件\n`);
  for (const item of picked) {
    console.log(`- [${item.tier}/${item.matchedKeyword}]${item.repeatSignal ? "[リピート]" : ""} ${item.itemName}`);
    console.log(`  価格: ¥${item.itemPrice} / レビュー: ${item.reviewAverage}(${item.reviewCount}件)`);
    console.log(`  URL: ${item.itemUrl}\n`);
  }

  await writeFile(
    new URL("./selected-products.json", import.meta.url),
    JSON.stringify(picked, null, 2)
  );

  const newHistory = new Set([...history, ...picked.map((i) => i.itemCode)]);
  await saveHistory(newHistory);

  console.log(`selected-products.json に保存しました。`);
}

main();
