// 楽天APIから「ふるさと納税×グルメ系」の商品を検索し、
// 価格帯・レビュー評価で絞り込んで、投稿候補としてJSONに保存する。

import { readFile, writeFile } from "node:fs/promises";

const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_SECRET;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

if (!appId || !accessKey) {
  console.error("RAKUTEN_APP_ID または RAKUTEN_SECRET が .env に設定されていません。");
  process.exit(1);
}

// ---- 選定条件(ここを調整して選定ジャンル・条件を変えられます) ----
const config = {
  baseKeyword: "ふるさと納税",
  subKeywords: ["肉", "海鮮", "米", "フルーツ", "スイーツ", "飲料"], // ローテーションするサブジャンル
  minPrice: 8000,
  maxPrice: 30000,
  minReviewCount: 10, // 最低レビュー件数(信頼性の目安)
  minReviewAverage: 4.0, // 最低評価点(5段階)
  hitsPerKeyword: 30,
  pickCount: 5, // 最終的に選ぶ件数
  // 商品名・キャッチコピーにこれらの語を含むものを「リピートが多い商品」とみなす
  repeatSignalKeywords: ["リピート", "定期便", "定期コース", "殿堂入り", "累計", "毎年注文", "何度も"],
  requireRepeatSignal: true, // trueならリピート語を含む商品のみ選定
};

function hasRepeatSignal(item) {
  const text = `${item.itemName} ${item.catchcopy ?? ""}`;
  return config.repeatSignalKeywords.some((kw) => text.includes(kw));
}

const HISTORY_FILE = new URL("./posted-history.json", import.meta.url);

async function loadHistory() {
  try {
    const raw = await readFile(HISTORY_FILE, "utf-8");
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveHistory(itemCodes) {
  await writeFile(HISTORY_FILE, JSON.stringify([...itemCodes], null, 2));
}

async function searchItems(keyword) {
  const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20220601");
  url.searchParams.set("applicationId", appId);
  url.searchParams.set("accessKey", accessKey);
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("minPrice", String(config.minPrice));
  url.searchParams.set("maxPrice", String(config.maxPrice));
  url.searchParams.set("hits", String(config.hitsPerKeyword));
  url.searchParams.set("sort", "-reviewCount"); // レビュー件数が多い順
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

async function main() {
  const history = await loadHistory();
  const candidates = [];
  const seenInThisRun = new Set();

  for (const sub of config.subKeywords) {
    const keyword = `${config.baseKeyword} ${sub}`;
    const items = await searchItems(keyword);
    for (const item of items) {
      if (history.has(item.itemCode)) continue; // 過去に選定済みは除外
      if (seenInThisRun.has(item.itemCode)) continue; // 今回の実行内での重複を除外
      seenInThisRun.add(item.itemCode);
      if (item.reviewCount < config.minReviewCount) continue;
      if (item.reviewAverage < config.minReviewAverage) continue;
      const repeatSignal = hasRepeatSignal(item);
      if (config.requireRepeatSignal && !repeatSignal) continue;
      candidates.push({ ...item, matchedKeyword: sub, repeatSignal });
    }
  }

  // レビュー件数×評価点で簡易スコアリングして上位を選ぶ
  candidates.sort(
    (a, b) => b.reviewCount * b.reviewAverage - a.reviewCount * a.reviewAverage
  );
  const picked = candidates.slice(0, config.pickCount);

  console.log(`候補: ${candidates.length}件 → 選定: ${picked.length}件\n`);
  for (const item of picked) {
    console.log(`- [${item.matchedKeyword}]${item.repeatSignal ? "[リピート]" : ""} ${item.itemName}`);
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
