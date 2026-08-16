// selected-products.json の内容から、シンプルな静的サイト(/docs)を生成する。
// 実行のたびに articles-data.json に商品を蓄積し、サイト全体を再生成する。

import { readFile, writeFile, mkdir } from "node:fs/promises";

const SITE_TITLE = "ふるさと納税＆グルメ セレクト";
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

function describeItem(item) {
  const reviewText = item.reviewCount > 0
    ? `レビュー評価 ${item.reviewAverage}点(${item.reviewCount}件)の人気商品です。`
    : "";
  const repeatText = item.repeatSignal ? "リピート購入者も多く、定期的に注文されている商品です。" : "";
  return `${reviewText}${repeatText}`.trim() || "楽天市場で人気の商品です。";
}

function pageShell({ title, body, isTop = false }) {
  const prefix = isTop ? "" : "../";
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${prefix}style.css">
</head>
<body>
<header><a href="${prefix}index.html" class="site-title">${escapeHtml(SITE_TITLE)}</a></header>
<main>${body}</main>
<footer><p>本サイトは楽天アフィリエイトプログラムを利用しています。</p></footer>
</body>
</html>`;
}

function articlePage(item) {
  const body = `
<article>
<h1>${escapeHtml(item.itemName)}</h1>
<p class="price">価格: ¥${item.itemPrice.toLocaleString()}</p>
<p>${escapeHtml(describeItem(item))}</p>
<p><a class="buy-btn" href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener">楽天市場で見る</a></p>
</article>`;
  return pageShell({ title: item.itemName, body });
}

function indexPage(items) {
  const cards = items
    .slice()
    .reverse()
    .map((item) => `
<a class="card" href="articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html">
  <h2>${escapeHtml(item.itemName.slice(0, 40))}${item.itemName.length > 40 ? "…" : ""}</h2>
  <p class="price">¥${item.itemPrice.toLocaleString()}</p>
</a>`)
    .join("\n");
  const body = `<h1>${escapeHtml(SITE_TITLE)}</h1>\n<div class="card-list">${cards}</div>`;
  return pageShell({ title: SITE_TITLE, body, isTop: true });
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
  await writeFile(ARTICLES_DATA_FILE, JSON.stringify(articles, null, 2));

  console.log(`サイト生成完了: 記事${articles.length}件 → docs/`);
}

main();
