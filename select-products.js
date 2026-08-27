// 楽天APIから商品を検索し、「高利益枠」と「安定枠」の2階層で選定してJSONに保存する。
//
// 高利益枠: 単価が高く1件あたりの報酬額が大きいジャンル(成約は難しいが当たれば大きい)
// 安定枠  : 単価は低いが定期便・消耗品でリピートされやすく、アクセス・成約数を稼ぐジャンル

import { readFile, writeFile } from "node:fs/promises";

const appId = process.env.RAKUTEN_APP_ID;
const accessKey = process.env.RAKUTEN_SECRET;
const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;
// 楽天デベロッパーズの「許可されたWebサイト」に登録するURLと完全に一致させること
// (2026-08-27: IPアドレス制限方式がGitHub Actionsの動的IPと相性が悪いため、
//  Webアプリケーションタイプ(リファラ制限方式)への切替に合わせて追加)
const APP_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate/";
const APP_ORIGIN = "https://yoshimitsu-20251105.github.io";

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
      // 2026-08-27: 肉・海鮮・米・フルーツを商品種別でさらに細分化(ユーザー指定の分類)。
      // 全キーワード実在庫を検証済み(research-log.md参照)。
      // 米のこだわり系(無農薬有機/自然栽培)は、小規模農家の商品名に「定期便」等の
      // リピート語がほとんど付かないため、requireRepeatSignal を個別にfalseへ上書きしている。
      subKeywords: [
        "牛肉 訳あり", "豚肉 訳あり", "鶏肉 訳あり", "ジビエ 肉",
        "マグロ 訳あり", "貝類 訳あり", "カニ 訳あり", "エビ 訳あり", "海鮮 訳あり",
        { keyword: "無農薬 有機 白米", requireRepeatSignal: false },
        { keyword: "無農薬 有機 玄米", requireRepeatSignal: false },
        { keyword: "自然栽培 白米", requireRepeatSignal: false },
        { keyword: "自然栽培 玄米", requireRepeatSignal: false },
        "みかん 訳あり", "りんご 訳あり", "ぶどう 訳あり",
      ],
      minPrice: 8000,
      maxPrice: 30000,
      minReviewCount: 10,
      minReviewAverage: 4.0,
      requireRepeatSignal: true,
      pickCount: 12,
    };
  }
  if (month >= 6 && month <= 8) {
    return {
      name: "季節枠(水・飲料)",
      baseKeyword: "",
      // 2026-08-27: 水を産地・種類別(シリカ水/軟水/温泉水)に、炭酸水・アイスコーヒーも
      // サブジャンル(強炭酸水/カフェオレ)を追加して細分化。全キーワード実在庫を検証済み。
      subKeywords: [
        "シリカ水 500ml 定期便", "軟水 500ml 定期便", "温泉水 定期便",
        "炭酸水 箱買い", "強炭酸水 箱買い",
        "アイスコーヒー まとめ買い", "カフェオレ まとめ買い",
      ],
      minPrice: 2000,
      maxPrice: 8000,
      minReviewCount: 15,
      minReviewAverage: 4.0,
      requireRepeatSignal: true,
      pickCount: 5,
    };
  }
  // 1〜5月: 閑散期。通年ジャンルを高利益枠としても厚めに
  // 2026-08-27: 元のキーワード(インテリア定期便/家電サブスク/キッチン用品定期便)は
  // 実在庫未検証だったため、実データで確認できたジャンルに差し替えた。
  return {
    name: "季節枠(通年ジャンル強化)",
    baseKeyword: "",
    subKeywords: ["寝具カバー セット", "食器 セット まとめ買い", "調理家電 セット"],
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
  // 2026-08-27: 各カテゴリをさらに商品種別で細分化(SNS用ランキングの深掘り)。
  // 全キーワード実在庫を検証済み(research-log.md参照)。細分化した分pickCountも増やした。
  subKeywords: [
    "プロテイン まとめ買い", "青汁 まとめ買い", "マルチビタミン まとめ買い",
    "美容ドリンク まとめ買い",
    "カレー レトルト まとめ買い", "パスタソース まとめ買い",
    "ドッグフード まとめ買い", "キャットフード まとめ買い",
    "ドリップコーヒー まとめ買い", "コーヒー豆 まとめ買い",
    "洗濯洗剤 液体 まとめ買い", "柔軟剤 詰め替え まとめ買い",
    // 2026-08-27: コスメ系を7区分(洗顔・日焼け止め・化粧水・乳液・美容液・オールインワン・
    // クレンジング)+幹細胞コスメ2区分(ヒト由来・植物由来。動物由来は市場にほぼ存在せず除外)に細分化
    "洗顔料 まとめ買い", "日焼け止め まとめ買い", "化粧水 まとめ買い", "乳液 まとめ買い",
    "美容液 まとめ買い", "オールインワンゲル まとめ買い", "クレンジング まとめ買い",
    "ヒト幹細胞 化粧品", "植物幹細胞 化粧品",
    "緑茶 ティーバッグ まとめ買い", "ほうじ茶 まとめ買い", "紅茶 ティーバッグ まとめ買い",
  ],
  minPrice: 1000,
  maxPrice: 6000,
  minReviewCount: 20,
  minReviewAverage: 3.8,
  requireRepeatSignal: true,
  pickCount: 14,
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
      headers: { accessKey, Authorization: `Bearer ${accessKey}`, Origin: APP_ORIGIN },
      referrer: APP_URL,
      referrerPolicy: "no-referrer-when-downgrade",
    });
    data = await res.json();
  } catch (e) {
    // オフライン・ネットワーク不通などでfetch自体が失敗した場合、クラッシュさせずエラーとして記録する
    console.error(`[${keyword}] ネットワークエラー:`, e.message);
    apiErrors.push(`${keyword}: ネットワークエラー(オフラインの可能性) ${e.message}`);
    return [];
  }
  // 楽天APIのエラー応答は data.error(旧形式)と data.errors.errorCode(新形式、IP制限等)の
  // 2種類の形があるため、両方を検知する(片方だけだと「エラーなのに気づけない」静かな失敗になる)
  if (data.error || data.errors) {
    const msg = data.error
      ? `${data.error} ${data.error_description ?? ""}`
      : `${data.errors.errorCode} ${data.errors.errorMessage ?? ""}`;
    console.error(`[${keyword}] APIエラー:`, msg);
    apiErrors.push(`${keyword}: ${msg}`);
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
      headers: { accessKey, Authorization: `Bearer ${accessKey}`, Origin: APP_ORIGIN },
      referrer: APP_URL,
      referrerPolicy: "no-referrer-when-downgrade",
    });
    data = await res.json();
  } catch (e) {
    console.error(`[総合ランキング] ネットワークエラー:`, e.message);
    apiErrors.push(`総合ランキング: ネットワークエラー(オフラインの可能性) ${e.message}`);
    return [];
  }
  if (data.error || data.errors) {
    const msg = data.error
      ? `${data.error} ${data.error_description ?? ""}`
      : `${data.errors.errorCode} ${data.errors.errorMessage ?? ""}`;
    console.error(`[総合ランキング] APIエラー:`, msg);
    apiErrors.push(`総合ランキング: ${msg}`);
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

// subKeywordsの各要素は文字列(通常時)、または { keyword, requireRepeatSignal } の形の
// オブジェクト(2026-08-27追加: こだわり系ニッチキーワードだけ「リピート語必須」を個別に
// 上書きしたい場合に使う。例: 無農薬・自然栽培の米は実在庫はあるが小規模農家の商品名に
// 「定期便」等のリピート語が付くことがほとんどなく、tier全体の条件のままでは実質選ばれない)
function normalizeSubKeyword(sub) {
  return typeof sub === "string" ? { keyword: sub } : sub;
}

async function pickFromTier(tier, history, seenInThisRun) {
  const candidates = [];
  for (const rawSub of tier.subKeywords) {
    const sub = normalizeSubKeyword(rawSub);
    const keyword = tier.baseKeyword ? `${tier.baseKeyword} ${sub.keyword}` : sub.keyword;
    const requireRepeatSignal = sub.requireRepeatSignal ?? tier.requireRepeatSignal;
    const items = await searchItems(keyword, tier);
    await sleep(1200); // レート制限(1秒1回)を守るための間隔
    for (const item of items) {
      if (history.has(item.itemCode)) continue;
      if (seenInThisRun.has(item.itemCode)) continue;
      seenInThisRun.add(item.itemCode);
      if (item.reviewCount < tier.minReviewCount) continue;
      if (item.reviewAverage < tier.minReviewAverage) continue;
      const repeatSignal = hasRepeatSignal(item);
      if (requireRepeatSignal && !repeatSignal) continue;
      candidates.push({ ...item, matchedKeyword: sub.keyword, repeatSignal, tier: tier.name });
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
