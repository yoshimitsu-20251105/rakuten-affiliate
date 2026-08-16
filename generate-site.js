// selected-products.json の内容から、シンプルな静的サイト(/docs)を生成する。
// 実行のたびに articles-data.json に商品を蓄積し、サイト全体を再生成する。

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SITE_TITLE = "ふるさと納税＆グルメ セレクト";
const SITE_URL = "https://yoshimitsu-20251105.github.io/rakuten-affiliate";
const ARTICLES_DATA_FILE = new URL("./articles-data.json", import.meta.url);
const DOCS_DIR = new URL("./docs/", import.meta.url);
const ARTICLES_DIR = new URL("./docs/articles/", import.meta.url);

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

function describeItem(item) {
  const parts = [reviewPhrase(item), repeatPhrase(item), tierPhrase(item)].filter(Boolean);
  return parts.join("") || "楽天市場で人気の商品です。";
}

// 楽天のサムネイルURLはクエリの _ex=WxH でサイズ指定できる
function imageUrl(item, size) {
  const raw = item.mediumImageUrls?.[0]?.imageUrl || item.smallImageUrls?.[0]?.imageUrl;
  if (!raw) return null;
  return raw.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
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
</head>
<body>
<header><a href="${prefix}index.html" class="site-title">${escapeHtml(SITE_TITLE)}</a></header>
<main>${body}</main>
<footer><p>本サイトは楽天アフィリエイトプログラムを利用しています。</p></footer>
</body>
</html>`;
}

function articlePage(item) {
  const img = imageUrl(item, 500);
  const imgTag = img ? `<img src="${img}" alt="${escapeHtml(item.itemName)}" class="article-img" loading="lazy">` : "";
  const description = describeItem(item);
  const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
  const body = `
<article>
${imgTag}
<h1>${escapeHtml(item.itemName)}</h1>
<p class="price">価格: ¥${item.itemPrice.toLocaleString()}</p>
<p>${escapeHtml(description)}</p>
<p><a class="buy-btn" href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener">楽天市場で見る</a></p>
</article>`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.itemName,
    image: img ? [img] : undefined,
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

function indexPage(items) {
  const cards = items
    .slice()
    .reverse()
    .map((item) => {
      const img = imageUrl(item, 300);
      const imgTag = img ? `<img src="${img}" alt="${escapeHtml(item.itemName)}" class="card-img" loading="lazy">` : "";
      return `
<a class="card" href="articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html">
  ${imgTag}
  <h2>${escapeHtml(item.itemName.slice(0, 40))}${item.itemName.length > 40 ? "…" : ""}</h2>
  <p class="price">¥${item.itemPrice.toLocaleString()}</p>
</a>`;
    })
    .join("\n");
  const body = `<h1>${escapeHtml(SITE_TITLE)}</h1>\n<div class="card-list">${cards}</div>`;
  return pageShell({
    title: SITE_TITLE,
    body,
    description: "ふるさと納税の人気グルメや、水・サプリなど定期便で買える人気商品を紹介しています。",
    canonicalPath: "index.html",
    isTop: true,
  });
}

function sitemapXml(items) {
  const urls = [
    `${SITE_URL}/index.html`,
    ...items.map((item) => `${SITE_URL}/articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`),
  ];
  const entries = urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function robotsTxt() {
  return `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`;
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

  for (const item of articles) {
    const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
    await writeFile(new URL(fileName, ARTICLES_DIR), articlePage(item));
  }
  await writeFile(new URL("index.html", DOCS_DIR), indexPage(articles));
  await writeFile(new URL("sitemap.xml", DOCS_DIR), sitemapXml(articles));
  await writeFile(new URL("robots.txt", DOCS_DIR), robotsTxt());
  await writeFile(ARTICLES_DATA_FILE, JSON.stringify(articles, null, 2));

  console.log(`サイト生成完了: 記事${articles.length}件 → docs/`);
}

main();
