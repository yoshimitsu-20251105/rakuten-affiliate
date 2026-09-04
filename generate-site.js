// selected-products.json の内容から、シンプルな静的サイト(/docs)を生成する。
// 実行のたびに articles-data.json に商品を蓄積し、サイト全体を再生成する。

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { scoreItem } from "./lib/quality-score.js";

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
// 2026-09-04: keyword-research機能から副作用なしで再利用できるよう、実装は
// lib/quality-score.js へ移動した(計算式・重み・出力は一切変更していない)。

// 楽天のサムネイルURLはクエリの _ex=WxH でサイズ指定できる
function imageUrl(raw, size) {
  return raw.replace(/_ex=\d+x\d+/, `_ex=${size}x${size}`);
}

function imageUrls(item, size, count) {
  const list = item.mediumImageUrls?.length ? item.mediumImageUrls : item.smallImageUrls ?? [];
  return list.slice(0, count).map((i) => imageUrl(i.imageUrl, size));
}

function pageShell({ title, body, description, canonicalPath, structuredData, isTop = false, image }) {
  const prefix = isTop ? "" : "../";
  const canonical = `${SITE_URL}/${canonicalPath}`;
  const descTag = description
    ? `<meta name="description" content="${escapeHtml(description)}">\n<meta property="og:description" content="${escapeHtml(description)}">`
    : "";
  // OGP画像/Twitter Cardタグ(2026-09-02追加): 従来og:imageが未設定だったため、
  // X/LINE等でリンク共有した際にサムネイル画像が表示されずクリック率を落としていた。
  // og:imageさえあればXはtwitter:card未設定でもsummary_large_imageとして表示するとされるが、
  // 挙動が不安定になるとの情報もあるため明示的にtwitter:cardも設定する。
  const imageTags = image
    ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:image" content="${escapeHtml(image)}">${description ? `\n<meta name="twitter:description" content="${escapeHtml(description)}">` : ""}`
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
<meta name="google-site-verification" content="1B8NP13E-4ecfPIJYaucSZLHYlRFfpQ0-TjSXPy43AM" />
<title>${escapeHtml(title)}</title>
${descTag}
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<link rel="stylesheet" href="${prefix}style.css">
${imageTags}
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
  // 「1秒で伝わる」社会的証明バッジ(Meta広告の定番パターン: 実績数字を目立たせる)
  const socialProofTag = item.reviewCount > 0
    ? `<div class="social-proof">⭐ ${item.reviewAverage} <span class="social-proof-count">${item.reviewCount.toLocaleString()}件${item.reviewCount >= 1000 ? "が選んだ" : "のレビュー"}</span></div>`
    : "";
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
${socialProofTag}
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
    image: imgs[0],
  });
}

const RANK_MEDALS = ["🥇", "🥈", "🥉", "④", "⑤", "⑥", "⑦", "⑧"];

// 2026-08-28: スコアの意味を実際の計算根拠以上に拡大解釈させないための開示文。
// 「最も安全」「健康に最も良い」等の断定を避け、レビューベースの人気度指標であることを明記する。
const SCORE_DISCLOSURE_TEXT =
  "当サイトのスコアは、楽天市場のレビュー評価・レビュー件数・リピート性(定期便等の表記)をもとにした独自の人気度指標であり、原材料・栄養成分・安全性を専門的に評価したものではありません。価格・在庫は変動する場合があるため、最新情報は各商品ページでご確認ください。";

// 2026-09-04: ランキングページ向けFAQ。既存のSCORE_DISCLOSURE_TEXT等の実データに基づく説明文を
// Q&A形式に再構成したもの(捏造禁止ルールに従い、新しい主張は追加せず既存の事実の言い換えのみ)。
// GoogleのFAQリッチリザルト表示自体は2026-05-07に全サイト対象で終了済みだが、
// FAQPage構造化データ自体は無効化されておらずページ理解・AI検索(GEO)での参照に使われ続けるとされる
// (「実装して損はない」程度の位置づけであり、劇的な効果を断定する根拠は見つからなかった)。
// 全ランキングページで同一のFAQ文になる点は、ランキング表自体がページごとに異なるため
// テンプレート的な補助コンテンツとして許容範囲と判断した。
const RANKING_FAQ = [
  {
    q: "このランキングのスコアはどうやって算出していますか？",
    a: SCORE_DISCLOSURE_TEXT,
  },
  {
    q: "掲載されている商品はどうやって選んでいますか？",
    a: "楽天市場のレビュー評価・レビュー件数・リピート性(定期便等の表記)をもとに、毎日自動で商品を選定してこのランキングに反映しています。人による個別のおすすめ順の入れ替えは行っていません。",
  },
  {
    q: "価格や在庫の情報は最新ですか？",
    a: "掲載している価格・在庫は取得時点のものであり、その後変動する場合があります。購入前に各商品ページで最新情報をご確認ください。",
  },
];

function faqBlock(entries) {
  const html = `
<section class="faq-section">
<h2>よくある質問</h2>
${entries
  .map(
    ({ q, a }) => `<details class="faq-item">
<summary>${escapeHtml(q)}</summary>
<p>${escapeHtml(a)}</p>
</details>`
  )
  .join("\n")}
</section>`;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return { html, structuredData };
}

// rankingPage()と統合ランキングページ(hubPage)の両方で使う行描画ロジックを共通化。
// pathPrefixは記事へのリンクの相対階層を吸収する("../articles/" or "articles/")。
// limitを指定すると上位N件だけに絞る(統合ページで各ジャンルを短く見せるため)。
function rankingRows(items, pathPrefix, limit) {
  const ranked = items
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit ?? items.length);

  return ranked
    .map(({ item, score }, i) => {
      const img = imageUrls(item, 200, 1)[0];
      const fileName = item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html";
      const urgency = urgencyBadge(item);
      return `
<tr${i < 3 ? ' class="rank-top3"' : ""}>
  <td class="rank-cell">${RANK_MEDALS[i] ?? i + 1}</td>
  <td>${img ? `<img src="${img}" alt="${escapeHtml(item.itemName)}" class="rank-img" loading="lazy">` : ""}</td>
  <td>
    <a href="${pathPrefix}${fileName}" class="rank-name">${escapeHtml(item.itemName.slice(0, 45))}${item.itemName.length > 45 ? "…" : ""}</a>
    ${urgency ? `<div class="urgency">⏰ ${escapeHtml(urgency)}</div>` : ""}
  </td>
  <td class="score-cell">${score}<span class="score-max">/100点</span></td>
  <td>¥${item.itemPrice.toLocaleString()}</td>
  <td>${item.reviewAverage}${item.reviewCount ? ` (${item.reviewCount.toLocaleString()}件)` : ""}</td>
  <td><a href="${item.itemUrl}" target="_blank" rel="nofollow sponsored noopener" class="buy-btn-sm">見る</a></td>
</tr>`;
    })
    .join("\n");
}

function rankingPage(groupTitle, groupSlug, items) {
  const rows = rankingRows(items, "../articles/");
  const topItem = items.map((item) => ({ item, score: scoreItem(item) })).sort((a, b) => b.score - a.score)[0]?.item;
  const topImage = topItem ? imageUrls(topItem, 500, 1)[0] : undefined;
  const faq = faqBlock(RANKING_FAQ);
  const body = `
<h1>${escapeHtml(groupTitle)}おすすめランキング</h1>
<p class="hook">レビュー評価・件数・リピート性をもとに100点満点でスコアリングし、総合点順にランキングしました。</p>
<div class="table-scroll">
<table class="rank-table">
<thead><tr><th>順位</th><th>画像</th><th>商品名</th><th>スコア</th><th>価格</th><th>評価</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<p class="micro-copy">${SCORE_DISCLOSURE_TEXT}</p>
${faq.html}
<p><a href="all.html">← ジャンル別ランキングまとめ一覧に戻る</a></p>
`;
  return pageShell({
    title: `${groupTitle}おすすめランキング比較`,
    body,
    description: `${groupTitle}の商品を、レビュー評価・件数・リピート性でスコアリングして比較したランキングです。`,
    canonicalPath: `rankings/${groupSlug}.html`,
    structuredData: faq.structuredData,
    image: topImage,
  });
}

// SNS投稿用の統合ランキングページ: 1つのURLで全ジャンルのランキングをまとめて見られるようにする
// (SNSでは投稿1回・リンク1つで済ませたいが、各ジャンル別ページを個別にシェアすると投稿が分散するため)。
// 各ジャンルは上位5件のみの短縮表示にし、続きは個別ページへのリンクに誘導する。
const HUB_ROW_LIMIT = 5;

function hubPage(rankingGroups) {
  const toc = rankingGroups
    .map((g) => `<li><a href="#${g.slug}">${escapeHtml(g.title)}</a></li>`)
    .join("\n");

  const sections = rankingGroups
    .map((g) => {
      const rows = rankingRows(g.items, "../articles/", HUB_ROW_LIMIT);
      const hasMore = g.items.length > HUB_ROW_LIMIT;
      return `
<section id="${g.slug}" class="hub-section">
<h2>${escapeHtml(g.title)}おすすめランキング(上位${Math.min(HUB_ROW_LIMIT, g.items.length)})</h2>
<div class="table-scroll">
<table class="rank-table">
<thead><tr><th>順位</th><th>画像</th><th>商品名</th><th>スコア</th><th>価格</th><th>評価</th><th></th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
${hasMore ? `<p><a href="${g.slug}.html">「${escapeHtml(g.title)}」の全${g.items.length}件を見る →</a></p>` : ""}
<p class="hub-back"><a href="#top">↑ 目次に戻る</a></p>
</section>`;
    })
    .join("\n");

  const faq = faqBlock(RANKING_FAQ);
  const body = `
<h1 id="top">ジャンル別ランキングまとめ</h1>
<p class="hook">気になるジャンルだけタップして見てください。レビュー評価・件数・リピート性をもとに100点満点でスコアリングしています。</p>
<nav class="hub-toc"><ul>${toc}</ul></nav>
${sections}
<p class="micro-copy">${SCORE_DISCLOSURE_TEXT}</p>
${faq.html}
`;
  const firstGroupTop = rankingGroups[0]?.items
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)[0]?.item;
  const hubImage = firstGroupTop ? imageUrls(firstGroupTop, 500, 1)[0] : undefined;
  return pageShell({
    title: "ジャンル別ランキングまとめ",
    body,
    description: "楽天市場の人気商品を、ジャンルごとにレビュー評価・件数・リピート性でスコアリングしたランキングを1ページにまとめました。",
    canonicalPath: "rankings/all.html",
    structuredData: faq.structuredData,
    image: hubImage,
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
    ? `<h2>おすすめ比較ランキング</h2>\n<p><a href="rankings/all.html" class="ranking-link-hub">🏆 ジャンル別ランキングまとめを1ページで見る</a></p>\n<div class="ranking-links">${rankingGroups
        .map((g) => `<a href="rankings/${g.slug}.html" class="ranking-link">🏆 ${escapeHtml(g.title)}おすすめランキング</a>`)
        .join("\n")}</div>`
    : "";
  const body = `<h1>${escapeHtml(SITE_TITLE)}</h1>\n${rankingLinks}\n<h2>新着商品</h2>\n<div class="card-list">${cards}</div>`;
  const newestItem = items[items.length - 1];
  const indexImage = newestItem ? imageUrls(newestItem, 500, 1)[0] : undefined;
  return pageShell({
    title: SITE_TITLE,
    body,
    description: "楽天市場のリアルタイムランキングとレビュー評価をもとに、ジャンルを問わず今売れている商品を毎日厳選して紹介しています。",
    canonicalPath: "index.html",
    isTop: true,
    image: indexImage,
  });
}

function sitemapXml(items, rankingGroups) {
  const urls = [
    `${SITE_URL}/index.html`,
    ...items.map((item) => `${SITE_URL}/articles/${item.itemCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`),
    ...rankingGroups.map((g) => `${SITE_URL}/rankings/${g.slug}.html`),
    ...(rankingGroups.length ? [`${SITE_URL}/rankings/all.html`] : []),
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
  const commodityGroups = [...groups.entries()]
    .filter(([, items]) => items.length >= 3)
    .map(([key, items]) => ({
      title: key,
      slug: key.replace(/[^a-zA-Z0-9ぁ-んァ-ヶー一-龠]/g, "_"),
      items,
    }));

  // 2026-08-27: 商品ジャンル別ランキングとは別に、ふるさと納税だけを横断的に集めた
  // 「ふるさと納税 総合ランキング」(上位10件)も需要があるため追加。判定はitemNameに
  // 「ふるさと納税」を含むかどうか(該当商品は必ずこの文言をタイトルに含む)。
  const furusatoItems = articles
    .filter((item) => item.itemName.includes("ふるさと納税"))
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ item }) => item);
  const furusatoGroup =
    furusatoItems.length >= 3
      ? [{ title: "ふるさと納税 総合", slug: "furusato-sougou", items: furusatoItems }]
      : [];

  // 2026-08-28: ペットフードも同様に、ジャンル別ランキングとは別に「ペットフード総合」を
  // 横断的に集めたランキングを追加(実装方針書に基づく)。判定はmatchedKeywordが
  // ペットフード関連キーワード(select-products.jsのevergreenTier参照)かどうかで行う。
  const PET_FOOD_KEYWORDS = new Set([
    "ドッグフード まとめ買い",
    "キャットフード まとめ買い",
    "国産 無添加 ドッグフード",
    "国産 無添加 キャットフード",
    "シニア犬 国産 無添加",
    "シニア猫 国産 無添加",
    "グレインフリー 国産 ドッグフード",
    "国産 無添加 犬 おやつ",
    "国産 無添加 猫 おやつ",
  ]);
  const petFoodItems = articles
    .filter((item) => PET_FOOD_KEYWORDS.has(item.matchedKeyword))
    .map((item) => ({ item, score: scoreItem(item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ item }) => item);
  const petFoodGroup =
    petFoodItems.length >= 3
      ? [{ title: "ペットフード総合", slug: "petfood-sougou", items: petFoodItems }]
      : [];

  // 2026-08-28: 同一商品シリーズ(同じ出店者)がランキング上位を占有しすぎていないか、
  // 目視確認用にログを出す(実装方針書の要求。完全なブランド正規化は今回実装しない)。
  for (const group of [...furusatoGroup, ...petFoodGroup, ...commodityGroups]) {
    const top5ShopCodes = group.items.slice(0, 5).map((item) => item.itemCode.split(":")[0]);
    const shopCounts = new Map();
    for (const shop of top5ShopCodes) shopCounts.set(shop, (shopCounts.get(shop) ?? 0) + 1);
    for (const [shop, count] of shopCounts) {
      if (count >= 3) {
        console.warn(`[要確認] 「${group.title}」の上位5件中${count}件が同じ出店者(${shop})です。同一商品シリーズが占有している可能性があります。`);
      }
    }
  }

  return [...furusatoGroup, ...petFoodGroup, ...commodityGroups];
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

  if (rankingGroups.length) {
    await writeFile(new URL("all.html", RANKING_DIR), hubPage(rankingGroups));
  }

  await writeFile(new URL("index.html", DOCS_DIR), indexPage(articles, rankingGroups));
  await writeFile(new URL("sitemap.xml", DOCS_DIR), sitemapXml(articles, rankingGroups));
  await writeFile(new URL("robots.txt", DOCS_DIR), robotsTxt());
  await writeFile(ARTICLES_DATA_FILE, JSON.stringify(articles, null, 2));

  console.log(`サイト生成完了: 記事${articles.length}件、ランキングページ${rankingGroups.length}件 → docs/`);
}

main();
