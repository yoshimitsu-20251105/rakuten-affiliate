// articles-data.json のランキンググループから、SNS投稿用の文章を生成する。
// 「広告」ではなく「発見・気づき」として読める、シェアしたくなるトーンで作成する。
// 生成された文章は social-posts.txt に出力。実際の投稿は手動で行う(自動投稿はしない)。

import { readFile, writeFile } from "node:fs/promises";

const SITE_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate";

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
      slug: key.replace(/[^a-zA-Z0-9ぁ-んァ-ヶー一-龠]/g, "_"),
      items,
    }));
}

// 「広告」でなく「発見・気づき」として読めるトーンの投稿文パターン
function buildPostText(group) {
  const ranked = group.items
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0].item;
  const url = `${SITE_URL}/rankings/${group.slug}.html`;

  const variants = [
`楽天で「${group.title}」を実際のレビュー数・評価でスコアリングして比べてみた。
1位は評価${top.reviewAverage}(${top.reviewCount.toLocaleString()}件)。
数字で見ると意外な結果に。

${url}`,

`「${group.title}」って結局どれがいいの?と思って、レビュー件数と評価点を100点満点でスコア化して並べてみた。
上位は${top.reviewCount.toLocaleString()}件超のレビューが根拠。

${url}`,

`${group.title}を選ぶとき、レビューの"数"と"評価"、どっちを信じます?
両方をスコア化してランキングにしてみたら、1位がはっきり分かれました。

${url}`,
  ];

  // グループごとに決定的にバリエーションを選ぶ(実行のたびに変わらないように)
  const idx = [...group.slug].reduce((a, c) => a + c.charCodeAt(0), 0) % variants.length;
  return variants[idx];
}

async function main() {
  const raw = await readFile(new URL("./articles-data.json", import.meta.url), "utf-8");
  const articles = JSON.parse(raw);
  const groups = buildRankingGroups(articles);

  if (groups.length === 0) {
    console.log("投稿できるランキングジャンルがまだありません。");
    return;
  }

  const posts = groups.map((g) => ({
    genre: g.title,
    url: `${SITE_URL}/rankings/${g.slug}.html`,
    text: buildPostText(g),
  }));

  const output = posts
    .map((p, i) => `===== ${i + 1}. ${p.genre} =====\n${p.text}\n`)
    .join("\n");

  await writeFile(new URL("./social-posts.txt", import.meta.url), output, "utf-8");

  console.log(`${posts.length}件の投稿文を social-posts.txt に出力しました。\n`);
  console.log(output);
}

main();
