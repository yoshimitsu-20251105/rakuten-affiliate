// 楽天ランキングの1ジャンルを、Instagramへ1日1投稿(カルーセル)で自動投稿する。
//
// 動き方:
//   1. articles-data.json からランキンググループ(3件以上)を作る
//   2. 規約・法律上リスクの高いジャンル(化粧品・サプリ等)を除外
//   3. 最後に投稿してから最も日が経っているジャンルを1つ選ぶ
//   4. 商品画像(加工しない)+ 先頭に【PR】を置いたキャプションで投稿
//   5. instagram-post-history.json に記録
//
// IG_USER_ID と IG_ACCESS_TOKEN が無い場合、または DRY_RUN=1 の場合は
// 投稿せず、下書きを instagram-preview.txt に出力するだけ(下書きモード)。
//
// 規約上の根拠(2025-06-26更新の楽天アフィリエイトガイドライン):
//   - 画像の上に文字・装飾を入れる/切り取るのは禁止 → 画像は一切加工しない
//   - 「#PR」をハッシュタグに埋もれさせるのは禁止 → キャプション1行目に明記
//   https://affiliate.rakuten.co.jp/guideline/rule/
//   https://affiliate.rakuten.co.jp/guideline/stealth_marketing_regulation/

import { readFile, writeFile } from "node:fs/promises";

const IG_USER_ID = process.env.IG_USER_ID || "";
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN || "";
// Facebookログイン経由のトークンなら graph.facebook.com、Instagramログイン経由なら graph.instagram.com
const IG_GRAPH_HOST = process.env.IG_GRAPH_HOST || "graph.facebook.com";
const IG_API_VERSION = process.env.IG_API_VERSION || "v23.0";
const DRY_RUN = process.env.DRY_RUN === "1" || !IG_USER_ID || !IG_ACCESS_TOKEN;

const HISTORY_FILE = new URL("./instagram-post-history.json", import.meta.url);
const PREVIEW_FILE = new URL("./instagram-preview.txt", import.meta.url);

// 同じジャンルを再投稿するまでの最低日数
const MIN_DAYS_BETWEEN_SAME_GENRE = 14;
// カルーセルに載せる商品数(Instagramの上限は10枚)
const ITEMS_PER_POST = 5;

// 人の確認なしで投稿すると薬機法・健康増進法の表現リスクが高いジャンルは自動投稿しない
const EXCLUDED_GENRE_PATTERN =
  /スキンケア|化粧品|美容液|洗顔|乳液|日焼け止め|サプリ|ヒト幹細胞|コスメ|健康|ダイエット|医薬|コンタクト/;

// キャプションに含まれていたら投稿を中止する語(効果効能・根拠のない緊急性など)
// 商品名にこれらが含まれる場合も、自動では投稿しない
const NG_WORDS = [
  "効く", "効果", "治る", "治す", "改善", "予防", "美白", "シワ", "若返", "痩せ",
  "デトックス", "免疫", "殺菌", "抗菌", "アンチエイジング", "医師", "最安", "日本一",
  "世界一", "No.1", "No1", "ナンバーワン", "今だけ", "期間限定", "数量限定", "限定",
];

function scoreItem(item) {
  const qualityScore = (item.reviewAverage / 5) * 55;
  const volumeScore = Math.min(item.reviewCount / 200, 1) * 30;
  const repeatScore = item.repeatSignal ? 15 : 0;
  return Math.round(qualityScore + volumeScore + repeatScore);
}

function buildRankingGroups(articles) {
  const groups = new Map();
  for (const item of articles) {
    const key = item.matchedKeyword;
    if (!key || key.startsWith("総合")) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length >= 3)
    .map(([key, items]) => ({
      title: key,
      items: items
        .map((item) => ({ item, score: scoreItem(item) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item),
    }));
}

// 商品名から【】[]などの宣伝文句を外し、短くする(文言の追加・誇張はしない)
function shortName(name) {
  const cleaned = String(name)
    .replace(/【[^】]*】|\[[^\]]*\]|［[^］]*］|〔[^〕]*〕|＼[^／]*／/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 32 ? `${cleaned.slice(0, 32)}…` : cleaned;
}

// 楽天APIの画像URLはサムネイル(128x128)なので、同じ画像のサイズ指定だけ変える。
// ガイドラインでサイズ変更は許可されている。画像そのものの加工はしない。
function largeImageUrl(item) {
  const url = item.mediumImageUrls?.[0]?.imageUrl;
  if (!url) return null;
  return url.replace(/\?_ex=\d+x\d+/, "?_ex=1080x1080");
}

function isFurusato(item) {
  return /^f\d{6}-/.test(item.itemCode || "");
}

function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function buildCaption(group, items) {
  const medals = ["1位", "2位", "3位", "4位", "5位"];
  const lines = items.map((item, i) => {
    const price = Number(item.itemPrice).toLocaleString("ja-JP");
    // ふるさと納税の返礼品(自治体ショップ: f+6桁のコード)は「価格」ではなく「寄附額」
    const priceLabel = isFurusato(item) ? `寄附額${price}円(ふるさと納税)` : `${price}円`;
    return `${medals[i]} ${shortName(item.itemName)}\n  評価${item.reviewAverage}(レビュー${item.reviewCount.toLocaleString("ja-JP")}件)/${priceLabel}`;
  });
  const tags = group.title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `#${w}`)
    .join(" ");

  return [
    "【PR】この投稿は楽天アフィリエイト広告を含みます",
    "",
    `楽天市場の「${group.title}」を、レビューの評価と件数で点数にして並べました。`,
    "",
    ...lines,
    "",
    `※価格・レビューは${todayJst()}時点の楽天市場の表示です。変わることがあります。`,
    "※画像は左から順位順です。",
    "比較ページはプロフィールのリンクから見られます。",
    "",
    `#楽天 #楽天市場 ${tags}`,
  ].join("\n");
}

function findNgWords(text) {
  return NG_WORDS.filter((w) => text.includes(w));
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function pickGroup(groups, history) {
  const lastPosted = new Map();
  for (const h of history) {
    const t = Date.parse(h.postedAt);
    if (!lastPosted.has(h.genre) || lastPosted.get(h.genre) < t) lastPosted.set(h.genre, t);
  }
  const now = Date.now();
  const candidates = groups
    .filter((g) => !EXCLUDED_GENRE_PATTERN.test(g.title))
    .filter((g) => {
      const t = lastPosted.get(g.title);
      return !t || now - t >= MIN_DAYS_BETWEEN_SAME_GENRE * 86400 * 1000;
    })
    // 未投稿のジャンルを優先し、次に最後の投稿が古い順
    .sort((a, b) => (lastPosted.get(a.title) ?? 0) - (lastPosted.get(b.title) ?? 0));
  return candidates;
}

// ---- Instagram API ----

async function igRequest(method, path, params) {
  const url = new URL(`https://${IG_GRAPH_HOST}/${IG_API_VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: IG_ACCESS_TOKEN });
  let res;
  if (method === "GET") {
    for (const [k, v] of body) url.searchParams.set(k, v);
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const code = data.error?.code;
    // code 190 = トークン切れ・無効。人が作り直す必要がある
    const hint = code === 190 ? "(アクセストークンの期限切れ・無効。作り直してSecretを更新してください)" : "";
    throw new Error(`Instagram API エラー [${path}] ${msg}${hint}`);
  }
  return data;
}

async function waitUntilReady(containerId) {
  for (let i = 0; i < 20; i++) {
    const { status_code } = await igRequest("GET", containerId, { fields: "status_code" });
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`コンテナ ${containerId} の状態が ${status_code} になりました(画像サイズ・形式を確認)`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`コンテナ ${containerId} の処理が60秒で終わりませんでした`);
}

async function publishCarousel(imageUrls, caption) {
  const limit = await igRequest("GET", `${IG_USER_ID}/content_publishing_limit`, {
    fields: "quota_usage,config",
  });
  console.log("投稿上限の使用状況:", JSON.stringify(limit.data ?? limit));

  const children = [];
  for (const image_url of imageUrls) {
    const { id } = await igRequest("POST", `${IG_USER_ID}/media`, {
      image_url,
      is_carousel_item: "true",
    });
    await waitUntilReady(id);
    children.push(id);
  }
  const { id: carouselId } = await igRequest("POST", `${IG_USER_ID}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  await waitUntilReady(carouselId);
  const { id: mediaId } = await igRequest("POST", `${IG_USER_ID}/media_publish`, {
    creation_id: carouselId,
  });
  return mediaId;
}

// ---- main ----

async function main() {
  const articles = JSON.parse(await readFile(new URL("./articles-data.json", import.meta.url), "utf-8"));
  const history = await loadHistory();
  const candidates = pickGroup(buildRankingGroups(articles), history);

  const skipped = [];
  let chosen = null;
  for (const group of candidates) {
    // 同じ商品のサイズ違い等が並ぶと見づらいので、表示名が同じものは上位1件だけ残す
    const seen = new Set();
    const items = group.items
      .filter((it) => largeImageUrl(it))
      .filter((it) => {
        const key = shortName(it.itemName);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, ITEMS_PER_POST);
    if (items.length < 2) {
      skipped.push(`${group.title}: 画像のある商品が2件未満`);
      continue;
    }
    const caption = buildCaption(group, items);
    const ng = findNgWords(caption);
    if (ng.length) {
      skipped.push(`${group.title}: 注意語を含むため自動投稿しない(${ng.join("、")})`);
      continue;
    }
    chosen = { group, items, caption, imageUrls: items.map(largeImageUrl) };
    break;
  }

  if (!chosen) {
    console.log("今日投稿できるジャンルがありません。");
    if (skipped.length) console.log(skipped.join("\n"));
    return;
  }

  const preview = [
    `モード: ${DRY_RUN ? "下書き(投稿しない)" : "本番投稿"}`,
    `ジャンル: ${chosen.group.title}`,
    "",
    "--- 画像(左から順) ---",
    ...chosen.imageUrls,
    "",
    "--- キャプション ---",
    chosen.caption,
    "",
    skipped.length ? `--- 見送ったジャンル ---\n${skipped.join("\n")}` : "",
  ].join("\n");
  await writeFile(PREVIEW_FILE, preview, "utf-8");
  console.log(preview);

  if (DRY_RUN) {
    console.log("\n下書きモードのため投稿していません(IG_USER_ID / IG_ACCESS_TOKEN 未設定、または DRY_RUN=1)。");
    return;
  }

  const mediaId = await publishCarousel(chosen.imageUrls, chosen.caption);
  history.push({
    genre: chosen.group.title,
    mediaId,
    itemCodes: chosen.items.map((i) => i.itemCode),
    postedAt: new Date().toISOString(),
  });
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2) + "\n", "utf-8");
  console.log(`\n投稿しました。media id: ${mediaId}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
