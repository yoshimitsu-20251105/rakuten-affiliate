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

// ---- 季節枠(高利益枠): 実行月に応じて自動で切り替える ----
// 9〜12月: ふるさと納税(年末の駆け込み需要期) / 6〜8月: 水・飲料(夏の需要期) / それ以外: 通年ジャンルを厚めに
function seasonalTier(month) {
  if (month >= 9 && month <= 12) {
    return {
      name: "季節枠(ふるさと納税)",
      baseKeyword: "ふるさと納税",
      // 2026-08-21: 頭キーワード(肉/海鮮/米/フルーツ単体)は大手3社(ふるさとチョイス/さとふる/ふるなび)が
      // 固定的に上位独占していることが調査で判明(research-log.md参照)。3〜4語のロングテール句に変更。
      subKeywords: ["肉 訳あり", "海鮮 小分け", "米 定期便", "フルーツ 訳あり"],
      minPrice: 8000,
      maxPrice: 30000,
      minReviewCount: 10,
      minReviewAverage: 4.0,
      requireRepeatSignal: true,
      pickCount: 3,
    };
  }
  if (month >= 6 && month <= 8) {
    return {
      name: "季節枠(水・飲料)",
      baseKeyword: "",
      // 2026-08-21: 実在庫件数を実際に検証した上で、フィルタ通過率が高い組み合わせに調整
      // (「定期便+送料無料」等を重ねすぎると実在庫がほぼ0件になる語句があったため)
      subKeywords: ["水 500ml 定期便", "炭酸水 箱買い", "アイスコーヒー まとめ買い"],
      minPrice: 2000,
      maxPrice: 8000,
      minReviewCount: 15,
      minReviewAverage: 4.0,
      requireRepeatSignal: true,
      pickCount: 3,
    };
  }
  // 1〜5月: 閑散期。通年ジャンルを高利益枠としても厚めに
  return {
    name: "季節枠(通年ジャンル強化)",
    baseKeyword: "",
    subKeywords: ["インテリア 定期便", "家電 サブスク", "キッチン用品 定期便"],
    minPrice: 5000,
    maxPrice: 20000,
    minReviewCount: 10,
    minReviewAverage: 3.8,
    requireRepeatSignal: false,
    pickCount: 3,
  };
}

// ---- 安定枠(エバーグリーン): 季節を問わず通年で選定対象にする ----
// ジャンルの間口を広げるほど、対応する検索クエリ(=集客経路)が増えるため、
// カテゴリ数を拡張(サプリ・美容だけでなく、ペット・日用品・飲料系も追加)
const evergreenTier = {
  name: "安定枠",
  baseKeyword: "",
  // 2026-08-21: 大手キュレーションサイト(マイベスト/サブスクラボ等)と競合しやすい
  // 頭〜中間キーワードを、具体的な商品種別+購入形態のロングテール句に変更。
  // 各語句は実際にAPIで在庫件数・フィルタ通過件数を検証済み(「送料無料」等を重ねすぎて
  // 実在庫0件になった組み合わせは除外し、「まとめ買い」系に置き換えている)
  subKeywords: [
    "サプリメント 定期便",
    "美容ドリンク まとめ買い",
    "レトルト食品 まとめ買い 送料無料",
    "ペットフード まとめ買い",
    "コーヒー豆 定期便",
    "洗濯洗剤 詰め替え まとめ買い",
    "化粧水 まとめ買い",
    "緑茶 ティーバッグ まとめ買い",
  ],
  minPrice: 1000,
  maxPrice: 6000,
  minReviewCount: 20,
  minReviewAverage: 3.8,
  requireRepeatSignal: true,
  pickCount: 5,
};

// ---- 発見枠: ジャンルを固定せず、楽天全体のリアルタイムランキングから発掘する ----
// 高額なブランド品・PCパーツなど単発商品も混ざるため、価格帯と品質フィルタで絞り込む
const discoveryTier = {
  name: "発見枠",
  minPrice: 1500,
  maxPrice: 15000,
  minReviewCount: 30,
  minReviewAverage: 4.0,
  requireRepeatSignal: false, // ランキング入りしていること自体が需要の証拠なのでリピート語は必須にしない
  pickCount: 3,
};

const currentMonth = new Date().getMonth() + 1;
const tiers = [seasonalTier(currentMonth), evergreenTier];
console.log(`実行月: ${currentMonth}月 → ${tiers[0].name}`);

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
  const url = new URL("https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701");
  url.searchParams.set("applicationId", appId);
  url.searchParams.set("accessKey", accessKey);
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("minPrice", String(tier.minPrice));
  url.searchParams.set("maxPrice", String(tier.maxPrice));
  url.searchParams.set("hits", String(hitsPerKeyword));
  url.searchParams.set("sort", "-reviewCount");
  url.searchParams.set("format", "json");

  let res, data;
  try {
    res = await fetch(url, {
      headers: { accessKey, Authorization: `Bearer ${accessKey}` },
    });
    data = await res.json();
  } catch (e) {
    // オフライン・ネットワーク不通などでfetch自体が失敗した場合、クラッシュさせずエラーとして記録する
    console.error(`[${keyword}] ネットワークエラー:`, e.message);
    apiErrors.push(`${keyword}: ネットワークエラー(オフラインの可能性) ${e.message}`);
    return [];
  }
  if (data.error) {
    console.error(`[${keyword}] APIエラー:`, data.error, data.error_description);
    apiErrors.push(`${keyword}: ${data.error} ${data.error_description ?? ""}`);
    return [];
  }
  return (data.Items ?? []).map((wrap) => wrap.Item);
}

// 楽天APIは「1秒に1回以下」の制限があるため、リクエスト間隔を空ける
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const apiErrors = [];

// ジャンルを指定しない総合リアルタイムランキング(上位30件)を取得
async function searchRanking() {
  const url = new URL("https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601");
  url.searchParams.set("applicationId", appId);
  url.searchParams.set("accessKey", accessKey);
  if (affiliateId) url.searchParams.set("affiliateId", affiliateId);
  url.searchParams.set("genreId", "0");
  url.searchParams.set("period", "realtime");
  url.searchParams.set("format", "json");

  let res, data;
  try {
    res = await fetch(url, {
      headers: { accessKey, Authorization: `Bearer ${accessKey}` },
    });
    data = await res.json();
  } catch (e) {
    console.error(`[総合ランキング] ネットワークエラー:`, e.message);
    apiErrors.push(`総合ランキング: ネットワークエラー(オフラインの可能性) ${e.message}`);
    return [];
  }
  if (data.error) {
    console.error(`[総合ランキング] APIエラー:`, data.error, data.error_description);
    apiErrors.push(`総合ランキング: ${data.error} ${data.error_description ?? ""}`);
    return [];
  }
  return (data.Items ?? []).map((wrap) => wrap.Item);
}

async function pickFromDiscovery(history, seenInThisRun) {
  const items = await searchRanking();
  await sleep(1200);
  const candidates = [];
  for (const item of items) {
    if (history.has(item.itemCode)) continue;
    if (seenInThisRun.has(item.itemCode)) continue;
    seenInThisRun.add(item.itemCode);
    if (item.itemPrice < discoveryTier.minPrice || item.itemPrice > discoveryTier.maxPrice) continue;
    if (item.reviewCount < discoveryTier.minReviewCount) continue;
    if (item.reviewAverage < discoveryTier.minReviewAverage) continue;
    const repeatSignal = hasRepeatSignal(item);
    if (discoveryTier.requireRepeatSignal && !repeatSignal) continue;
    candidates.push({ ...item, matchedKeyword: `総合${item.rank}位`, repeatSignal, tier: discoveryTier.name });
  }
  candidates.sort((a, b) => b.reviewCount * b.reviewAverage - a.reviewCount * a.reviewAverage);
  return candidates.slice(0, discoveryTier.pickCount);
}

async function pickFromTier(tier, history, seenInThisRun) {
  const candidates = [];
  for (const sub of tier.subKeywords) {
    const keyword = tier.baseKeyword ? `${tier.baseKeyword} ${sub}` : sub;
    const items = await searchItems(keyword, tier);
    await sleep(1200); // レート制限(1秒1回)を守るための間隔
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

  const discoveryItems = await pickFromDiscovery(history, seenInThisRun);
  picked.push(...discoveryItems);

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

  // APIエラーがあれば、後続のパイプラインが検知できるようファイルに残す
  const errorFile = new URL("./api-errors.log", import.meta.url);
  if (apiErrors.length > 0) {
    await writeFile(errorFile, apiErrors.join("\n"));
    console.error(`APIエラーが${apiErrors.length}件発生しました。api-errors.log を確認してください。`);
  } else {
    await writeFile(errorFile, "");
  }
}

main();
