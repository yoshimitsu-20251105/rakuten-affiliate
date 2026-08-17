// selected-products.json の内容から、シンプルな静的サイト(/docs)を生成する。
// 実行のたびに articles-data.json に商品を蓄積し、サイト全体を再生成する。

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SITE_TITLE = "楽天トレンドセレクト";
const SITE_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate";
const ARTICLES_DATA_FILE = new URL("./articles-data.json", import.meta.url);
const DOCS_DIR = new URL("./docs/", import.meta.url);
const ARTICLES_DIR = new URL("./docs/articles/", import.meta.url);
const RANKING_DIR = new URL("./docs/rankings/", import.meta.url);
const NOW = new Date();
const TODAY_ISO = NOW.toISOString().slice(0, 10);
const TODAY_JP = `${NOW.getFullYear()}年${NOW.getMonth() + 1}月${NOW.getDate()}日`;
// GA4測定ID(.envのGA_MEASUREMENT_IDから読み込み)。未設定なら解析タグは出力しない
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || "";

async function loadJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf-8"));
  } catch {
    return fallback;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// レビュー件数の規模感に応じた書き分け
function reviewPhrase(item) {
  if (item.reviewCount === 0) return "";
  if (item.reviewCount >= 10000) {
    return `${item.reviewCount.toLocaleString()}件を超えるレビューが集まる、定番の人気商品です。評価は${item.reviewAverage}点と高水準を維持しています。`;
  }
  if (item.reviewCount >= 1000) {
    return `レビュー${item.reviewCount.toLocaleString()}件・評価${item.reviewAverage}点と、多くの人に選ばれている実績があります。`;
  }
  return `レビュー評価${item.reviewAverage}点(${item.reviewCount}件)。まだ件数は少なめですが高評価が付いています。`;
}

// リピート/定期便シグナルの有無での書き分け
function repeatPhrase(item) {
  if (!item.repeatSignal) return "";
  const variants = [
    "定期便での購入者も多く、リピート率の高さがうかがえます。",
    "一度試すとまた頼みたくなる、と評判の商品です。",
    "継続して注文する人が多く、満足度の高さを裏付けています。",
  ];
  // 商品コードを元に決定的にバリエーションを選ぶ(実行のたびに変わらないように)
  const idx = [...item.itemCode].reduce((a, c) => a + c.charCodeAt(0), 0) % variants.length;
  return variants[idx];
}

// 価格帯・階層に応じた書き分け
function tierPhrase(item) {
  if (item.itemPrice >= 10000) {
    return "少し贅沢したい時や、特別な日の一品としてもおすすめです。";
  }
  if (item.itemPrice <= 3000) {
    return "普段使いしやすい価格帯で、まとめ買いにも向いています。";
  }
  return "";
}

// 正直な注意点を一言添える(メリットだけでなくデメリットも書く方が信頼され、成約率が上がるため)
function caveatPhrase(item) {
  const variants = [
    "人気商品のため、時期によっては入荷までお時間がかかる場合があります。",
    "口コミには個人差もあるため、購入前に商品ページのレビューも合わせてチェックするのがおすすめです。",
    "セット内容や数量で価格が変わることがあるので、購入前に選択肢を確認してみてください。",
  ];
  const idx = ([...item.itemCode].reduce((a, c) => a + c.charCodeAt(0), 0) + 1) % variants.length;
  return variants[idx];
}

// 行動を後押しするクロージング文
function closingPhrase(item) {
  const variants = [
    "気になった方は、この機会にチェックしてみてください。",
    "詳しい内容は商品ページで確認してみると、イメージが掴みやすいと思います。",
    "在庫や価格は変動することがあるので、早めに見ておくと安心です。",
  ];
  const idx = ([...item.itemCode].reduce((a, c) => a + c.charCodeAt(0), 0) + 2) % variants.length;
  return variants[idx];
}

function describeItem(item) {
  const parts = [reviewPhrase(item), repeatPhrase(item), tierPhrase(item)].filter(Boolean);
  return parts.join("") || "楽天市場で人気の商品です。";
}

// itemCaption(販売者が書いた商品詳細)から「商品説明」部分を抜き出し、
// こだわり・特徴が伝わる短い箇条書きに変換する(実在するデータのみ使用、創作しない)
const CAPTION_LABELS = ["原材料", "アレルギー表記", "賞味期限", "消費期限", "保存方法", "配送方法", "提供元", "注意事項", "名称", "内容量", "サイズ", "お届け", "発送時期", "製造者", "販売者"];

function extractFeatureBullets(item, max = 3) {
  const raw = item.itemCaption;
  if (!raw) return [];

  let section = raw;
  const startMatch = raw.match(/商品説明\s*/);
  if (startMatch) {
    section = raw.slice(startMatch.index + startMatch[0].length);
  }
  // 次のラベルが出てきたところで切る
  let cutAt = section.length;
  for (const label of CAPTION_LABELS) {
    const idx = section.indexOf(label);
    if (idx > 0 && idx < cutAt) cutAt = idx;
  }
  section = section.slice(0, Math.min(cutAt, 400));

  const sentences = section
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 70); // 短すぎ・長すぎる断片は除外

  return sentences.slice(0, max).map((s) => (s.endsWith("！") || s.endsWith("!") ? s : s + "。"));
}

// 期間限定・数量限定などの煽り文句は、実際に販売者がそう記載している場合のみ表示する
// (捏造した緊急性は景品表示法上のリスクがあるため使わない)
const SCARCITY_WORDS = ["数量限定", "期間限定", "タイムセール", "在庫限り", "売り切れ次第終了", "個数限定", "早期終了"];
function urgencyBadge(item) {
  const text = `${item.itemName} ${item.catchcopy ?? ""}`;
  const found = SCARCITY_WORDS.find((w) => text.includes(w));
  if (found) return found;
  // 実際にキャンペーン終了日が設定されており、かつ現実的な近future日付の場合のみ
  if (item.endTime) {
    const end = new Date(item.endTime);
    const now = new Date();
    const daysLeft = (end - now) / (1000 * 60 * 60 * 24);
    if (daysLeft > 0 && daysLeft <= 90) return `${end.getMonth() + 1}/${end.getDate()}まで`;
  }
  return null;
}

// ジェイ・エイブラハムの「客単価×購入頻度×客数」に沿った100点満点スコア
// (レビュー評価=品質の証拠、レビュー件数=客数の実績、リピート性=購入頻度の代理指標)
function scoreItem(item) {
  const qualityScore = (item.reviewAverage / 5) * 55; // 品質: 最大55点
  const volumeScore = Math.min(item.reviewCount / 200, 1) * 30; // 実績: 最大30点(200件で頭打ち)
  const repeatScore = item.repeatSignal ? 15 : 0; // 購入頻度の高さ: 15点
  return Math.round(qualityScore + volumeScore + repeatScore);
}

// 楽天のサムネイルURLはクエリの _ex=WxH でサイズ指定できる
function imageUrl(raw, size) {
  return raw.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
}

function imageUrls(item, size, count) {
  const list = item.mediumImageUrls?.length ? item.mediumImageUrls : item.smallImageUrls ?? [];
  return list.slice(0, count).map((i) => imageUrl(i.imageUrl, size));
}

function pageShell({ title, body, description, canonicalPath, structuredData, isTop = false }) {
  const prefix = isTop ? "" : "../";
  const canonical = `${SITE_URL}/${canonicalPath}`;
  const descTag = description
    ? `<meta name="description" content="${escapeHtml(description)}">\n<meta property="og:description" content="${escapeHtml(description)}">`
    : "";
  const jsonLd = structuredData
    ? `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`
    : "";
  const gaTag = GA_MEASUREMENT_ID
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');</script>`
    : "";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${descTag}
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<link rel="stylesheet" href="${prefix}style.css">
${jsonLd}
${gaTag}
</head>
<body>
<header><a href="${prefix}index.html" class="site-title">${escapeHtml(SITE_TITLE)}</a></header>
<main>${body}</main>
<footer>
<p>本サイトは楽天アフィリエイトプログラムを利用しています。紹介する商品は楽天市場のレビュー評価・売れ筋ランキングをもとに毎日自動で選定しています。</p>
<p>運営者: 楽天トレンドセレクト運営チーム / 最終更新日: ${TODAY_JP}</p>
</footer>
</body>
</html>`;
}

function relatedProductsBlock(item, articles, rankingSlugByKeyword) {
  const key = item.matchedKeyword;
  if (!key || key.startsWith("総合")) return "";

  const related = articles
    .filter((a) => a.matchedKeyword === key && a.itemCode !== item.itemCode)
    .map((a) => ({ item: a, score: scoreItem(a) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (related.length === 0) return "";

  const rankingSlug = rankingSlugByKeyword.get(key);
  const rankingLink = rankingSlug
    ? `<a href="../rankings/${rankingSlug}.html" class="ranking-link-sm">🏆 「${escapeHtml(key)}」のランキング比較を見る</a>`
    : "";

  const cards = related
    .map(({ item: r }) => {
      const img = imageUrls(r, 200, 1)[0];
      const fileName = r.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
      return `
<a class="related-card" href="${fileName}">
  ${img ? `<img src="${img}" alt="${escapeHtml(r.itemName)}" class="related-img" loading="lazy">` : ""}
  <span class="related-name">${escapeHtml(r.itemName.slice(0, 30))}${r.itemName.length > 30 ? "…" : ""}</span>
  <span class="related-price">¥${r.itemPrice.toLocaleString()}</span>
</a>`;
    })
    .join("\n");

  return `
<section class="related-section">
<h2>関連商品も比較する</h2>
${rankingLink}
<div class="related-list">${cards}</div>
</section>`;
}

function articlePage(item, articles, rankingSlugByKeyword) {
  const imgs = imageUrls(item, 500, 3);
  const galleryTag = imgs.length
    ? `<div class="img-gallery">${imgs.map((u) => `<img src="${u}" alt="${escapeHtml(item.itemName)}" class="article-img" loading="lazy">`).join("")}</div>`
    : "";
  const hook = item.catchcopy && item.catchcopy !== item.itemName ? `<p class="hook">${escapeHtml(item.catchcopy)}</p>` : "";
  const urgency = urgencyBadge(item);
  const urgencyTag = urgency ? `<p class="urgency">⏰ ${escapeHtml(urgency)}</p>` : "";
  const featureBullets = extractFeatureBullets(item);
  const featureList = featureBullets.length
    ? `<ul class="features"><li>${featureBullets.map(escapeHtml).join("</li><li>")}</li></ul>`
    : "";
  const trustBullets = [reviewPhrase(item), repeatPhrase(item), tierPhrase(item)].filter(Boolean);
  const trustList = trustBullets.length
    ? `<ul class="trust">${trustBullets.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";
  const description = describeItem(item);
  const caveat = caveatPhrase(item);
  const closing = closingPhrase(item);
  const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
  const relatedBlock = relatedProductsBlock(item, articles, rankingSlugByKeyword);
  const body = `
<article>
${galleryTag}
<h1>${escapeHtml(item.itemName)}</h1>
${hook}
${urgencyTag}
<p class="price">価格: ¥${item.itemPrice.toLocaleString()}</p>
<div class="cta-quick"><a class="buy-btn-sm" href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener">▶ 楽天市場で価格・在庫を見る</a></div>
${featureList}
${trustList}
<p class="caveat">${escapeHtml(caveat)}</p>
<p class="closing">${escapeHtml(closing)}</p>
<div class="cta-block">
  <a class="buy-btn" href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener">▶ 今すぐ楽天市場で詳細を見る</a>
  <p class="micro-copy">価格・在庫は変動する場合があります(公式ページで最新情報を確認できます)</p>
</div>
<p class="provenance">情報取得日: ${TODAY_JP}(楽天市場の商品情報をもとに作成)</p>
${relatedBlock}
</article>`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.itemName,
    image: imgs.length ? imgs : undefined,
    description,
    offers: {
      "@type": "Offer",
      price: item.itemPrice,
      priceCurrency: "JPY",
      url: item.itemUrl,
      availability: "https://schema.org/InStock",
    },
    aggregateRating: item.reviewCount > 0 ? {
      "@type": "AggregateRating",
      ratingValue: item.reviewAverage,
      reviewCount: item.reviewCount,
    } : undefined,
  };
  return pageShell({
    title: item.itemName,
    body,
    description,
    canonicalPath: `articles/${fileName}`,
    structuredData,
  });
}

const RANK_MEDALS = ["🥇", "🥈", "🥉", "④", "⑤", "⑥", "⑦", "⑧"];

function rankingPage(groupTitle, groupSlug, items) {
  const ranked = items
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score);

  const rows = ranked
    .map(({ item, score }, i) => {
      const img = imageUrls(item, 200, 1)[0];
      const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
      const urgency = urgencyBadge(item);
      return `
<tr>
  <td class="rank-cell">${RANK_MEDALS[i] ?? i + 1}</td>
  <td>${img ? `<img src="${img}" alt="${escapeHtml(item.itemName)}" class="rank-img" loading="lazy">` : ""}</td>
  <td>
    <a href="../articles/${fileName}" class="rank-name">${escapeHtml(item.itemName.slice(0, 45))}${item.itemName.length > 45 ? "…" : ""}</a>
    ${urgency ? `<div class="urgency">⏰ ${escapeHtml(urgency)}</div>` : ""}
  </td>
  <td class="score-cell">${score}<span class="score-max">/100点</span></td>
  <td>¥${item.itemPrice.toLocaleString()}</td>
  <td>${item.reviewAverage}${item.reviewCount ? ` (${item.reviewCount.toLocaleString()}件)` : ""}</td>
  <td><a href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener" class="buy-btn-sm">見る</a></td>
</tr>`;
    })
    .join("\n");

  const body = `
<h1>${escapeHtml(groupTitle)}おすすめランキング</h1>
<p class="hook">レビュー評価・件数・リピート性をもとに100点満点でスコアリングし、総合点順にランキングしました。</p>
<div class="table-scroll">
<table class="rank-table">
<thead><tr><th>順位</th><th>画像</th><th>商品名</th><th>スコア</th><th>価格</th><th>評価</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<p class="micro-copy">スコアはレビュー評価(55点)・レビュー件数の実績(30点)・リピート性(15点)の合計です。価格・在庫は変動する場合があるため、最新情報は各商品ページでご確認ください。</p>
`;
  return pageShell({
    title: `${groupTitle}おすすめランキング比較`,
    body,
    description: `${groupTitle}の商品を、レビュー評価・件数・リピート性でスコアリングして比較したランキングです。`,
    canonicalPath: `rankings/${groupSlug}.html`,
  });
}

function indexPage(items, rankingGroups) {
  const cards = items
    .slice()
    .reverse()
    .map((item) => {
      const img = imageUrls(item, 300, 1)[0];
      const imgTag = img ? `<img src="${img}" alt="${escapeHtml(item.itemName)}" class="card-img" loading="lazy">` : "";
      return `
<a class="card" href="articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html">
  ${imgTag}
  <h2>${escapeHtml(item.itemName.slice(0, 40))}${item.itemName.length > 40 ? "…" : ""}</h2>
  <p class="price">¥${item.itemPrice.toLocaleString()}</p>
</a>`;
    })
    .join("\n");
  const rankingLinks = rankingGroups.length
    ? `<h2>おすすめ比較ランキング</h2>\n<div class="ranking-links">${rankingGroups
        .map((g) => `<a href="rankings/${g.slug}.html" class="ranking-link">🏆 ${escapeHtml(g.title)}おすすめランキング</a>`)
        .join("\n")}</div>`
    : "";
  const body = `<h1>${escapeHtml(SITE_TITLE)}</h1>\n${rankingLinks}\n<h2>新着商品</h2>\n<div class="card-list">${cards}</div>`;
  return pageShell({
    title: SITE_TITLE,
    body,
    description: "楽天市場のリアルタイムランキングとレビュー評価をもとに、ジャンルを問わず今売れている商品を毎日厳選して紹介しています。",
    canonicalPath: "index.html",
    isTop: true,
  });
}

function sitemapXml(items, rankingGroups) {
  const urls = [
    `${SITE_URL}/index.html`,
    ...items.map((item) => `${SITE_URL}/articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`),
    ...rankingGroups.map((g) => `${SITE_URL}/rankings/${g.slug}.html`),
  ];
  const entries = urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY_ISO}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function robotsTxt() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

// matchedKeywordが同じ商品同士をグループ化し、3件以上集まったジャンルのみランキングページを作る
// (発見枠は「総合○位」というランク表記でジャンル性がないため対象外)
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
      slug: key.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠]/g, "_"),
      items,
    }));
}

async function main() {
  const newItems = await loadJson(new URL("./selected-products.json", import.meta.url), []);
  const articles = await loadJson(ARTICLES_DATA_FILE, []);

  const existingCodes = new Set(articles.map((a) => a.itemCode));
  for (const item of newItems) {
    if (!existingCodes.has(item.itemCode)) {
      articles.push(item);
      existingCodes.add(item.itemCode);
    }
  }

  await mkdir(ARTICLES_DIR, { recursive: true });
  await mkdir(RANKING_DIR, { recursive: true });

  const rankingGroups = buildRankingGroups(articles);
  const rankingSlugByKeyword = new Map(rankingGroups.map((g) => [g.title, g.slug]));

  for (const item of articles) {
    const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
    await writeFile(new URL(fileName, ARTICLES_DIR), articlePage(item, articles, rankingSlugByKeyword));
  }

  for (const g of rankingGroups) {
    await writeFile(new URL(g.slug + ".html", RANKING_DIR), rankingPage(g.title, g.slug, g.items));
  }

  await writeFile(new URL("index.html", DOCS_DIR), indexPage(articles, rankingGroups));
  await writeFile(new URL("sitemap.xml", DOCS_DIR), sitemapXml(articles, rankingGroups));
  await writeFile(new URL("robots.txt", DOCS_DIR), robotsTxt());
  await writeFile(ARTICLES_DATA_FILE, JSON.stringify(articles, null, 2));

  console.log(`サイト生成完了: 記事${articles.length}件、ランキングページ${rankingGroups.length}件 → docs/`);
}

main();
