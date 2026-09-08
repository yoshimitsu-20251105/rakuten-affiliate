// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 決定的なHTMLテンプレート生成(2026-09-07対応)。
// 外部生成AI(LLM)は一切呼び出さない。すべて固定の文言・構造とデータの埋め込みのみ。
// scriptタグ・外部トラッキングは追加しない。
//
// 【厳守・非公開情報】normalizedKeyword・WebKeywordScore・FinalPriority・source run・
// candidateSetHash・approvedFileHash・Quality Score・ISO形式日時・内部理由コード・
// sellerのcatchcopy全文は、このテンプレートへは一切渡さない設計にする(呼び出し側の
// 責務)。念のためテンプレート自身もこれらのキーを受け取らない。
//
// 【厳守・表現】病気の治療・予防・健康効果を断定する表現は使わない。特定原材料が
// アレルギー対策になる等の断定をしない。持病・食事制限がある場合は獣医師へ相談する
// 旨を促す(医療的判断そのものは行わない)。

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatPrice(price) {
  return typeof price === "number" ? `¥${price.toLocaleString("ja-JP")}` : "価格情報なし";
}

function formatReview(average, count) {
  if (typeof average !== "number" || typeof count !== "number") return "レビュー情報なし";
  return `${average.toFixed(2)} (${count.toLocaleString("ja-JP")}件)`;
}

/**
 * ISO日時文字列を「2026年9月7日時点」の形式(JST基準の日付のみ)へ整形する。
 * @param {string} isoString
 * @returns {string}
 */
export function formatJaDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日時点`;
}

/**
 * @param {{
 *   title: string, slug: string, introText: string, buyingGuideText: string,
 *   dataRetrievedAtJa: string,
 *   products: Array<{
 *     rank: number, displayName: string, displayNote?: string|null,
 *     imageUrl: string, itemPrice: number|null, reviewAverage: number|null, reviewCount: number|null,
 *     verifiedAttributeLabels: string[], affiliateUrl: string,
 *   }>,
 * }} data
 * @returns {string} 完全なHTML文書
 */
export function renderPublicationPreviewHtml(data) {
  const { title, slug, introText, buyingGuideText, dataRetrievedAtJa, products } = data;

  const cards = products
    .map(
      (p) => `
      <article class="product-card">
        <div class="rank-badge">${p.rank}位</div>
        <img class="product-image" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.displayName)}" width="128" height="128" loading="lazy">
        <h3 class="product-name">${escapeHtml(p.displayName)}</h3>
        <p class="product-price">${formatPrice(p.itemPrice)}</p>
        <p class="product-review">レビュー: ${formatReview(p.reviewAverage, p.reviewCount)}</p>
        ${p.verifiedAttributeLabels.length > 0 ? `<ul class="product-attrs">${p.verifiedAttributeLabels.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` : ""}
        ${p.displayNote ? `<p class="product-note">※ ${escapeHtml(p.displayNote)}</p>` : ""}
        <a class="cta-button" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">楽天市場で在庫・価格を確認してください</a>
      </article>`
    )
    .join("\n");

  const tableRows = products
    .map(
      (p) => `
        <tr>
          <td>${p.rank}</td>
          <td>${escapeHtml(p.displayName)}</td>
          <td>${formatPrice(p.itemPrice)}</td>
          <td>${formatReview(p.reviewAverage, p.reviewCount)}</td>
        </tr>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>【下書き・非公開】${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fafaf8; --fg:#222; --card-bg:#fff; --border:#e2e2df; --accent:#bf0000; --muted:#6a6a64; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1a1a1a; --fg:#eee; --card-bg:#262626; --border:#3a3a3a; --muted:#a3a39c; } }
  * { box-sizing: border-box; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui,-apple-system,"Segoe UI","Hiragino Sans",sans-serif; line-height:1.7; }
  header { padding:0.9rem 1rem; border-bottom:1px solid var(--border); }
  header a.site-title { color:var(--fg); text-decoration:none; font-weight:bold; font-size:1.1rem; }
  .draft-banner { background:var(--accent); color:#fff; text-align:center; padding:0.7rem 0.5rem; font-weight:bold; font-size:0.95rem; }
  main { max-width: 720px; margin: 0 auto; padding: 1.1rem; }
  h1 { font-size: 1.25rem; line-height:1.5; }
  .disclosure-box { background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:0.9rem; margin:1rem 0; font-size:0.82rem; color:var(--muted); }
  .criteria-box { font-size:0.88rem; color:var(--muted); margin: 1rem 0; }
  .product-grid { display:flex; flex-direction:column; gap:1rem; margin: 1.25rem 0; }
  .product-card { position:relative; background:var(--card-bg); border:1px solid var(--border); border-radius:12px; padding:1rem; text-align:center; }
  .rank-badge { position:absolute; top:0.6rem; left:0.6rem; background:var(--accent); color:#fff; border-radius:999px; padding:0.2rem 0.65rem; font-size:0.8rem; font-weight:bold; }
  .product-image { display:block; margin: 0.5rem auto 0.75rem; border-radius:8px; max-width:128px; height:auto; }
  .product-name { font-size:0.95rem; margin: 0.3rem 0; word-break: break-word; }
  .product-price { font-size:1.05rem; font-weight:bold; margin:0.2rem 0; }
  .product-review { font-size:0.85rem; color:var(--muted); margin:0.2rem 0; }
  .product-attrs { list-style:none; padding:0; margin:0.5rem 0; display:flex; flex-wrap:wrap; gap:0.3rem; justify-content:center; }
  .product-attrs li { background:rgba(128,128,128,0.12); border-radius:999px; padding:0.15rem 0.6rem; font-size:0.75rem; }
  .product-note { font-size:0.78rem; color:var(--accent); margin:0.5rem 0; }
  .cta-button { display:inline-block; margin-top:0.6rem; background:var(--accent); color:#fff; text-decoration:none; padding:0.7rem 1.4rem; border-radius:8px; font-weight:bold; font-size:0.9rem; max-width:100%; }
  .table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  table { width:100%; border-collapse:collapse; background:var(--card-bg); font-size:0.82rem; }
  th, td { border:1px solid var(--border); padding:0.5rem; vertical-align:top; }
  th { background:rgba(128,128,128,0.08); }
  .guide-box, .caution-box { font-size:0.82rem; color:var(--muted); border-top:1px solid var(--border); margin-top:1.5rem; padding-top:1rem; }
  footer { margin-top:2rem; padding:1rem; border-top:1px solid var(--border); font-size:0.78rem; color:var(--muted); }
  @media (max-width: 480px) {
    main { padding:0.85rem; }
  }
</style>
</head>
<body>
<header><span class="site-title">楽天トレンドセレクト</span></header>
<div class="draft-banner">⚠ DRAFT・非公開ページ(承認済みだが未掲載、社内試験用) ⚠</div>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="hook">${escapeHtml(introText)}</p>

<div class="disclosure-box">
  本ページには楽天アフィリエイトプログラムのリンクを含みます。紹介する商品は、人間が内容を確認したうえで掲載しています。
  掲載している価格・レビュー情報は${escapeHtml(dataRetrievedAtJa)}のものであり、その後変動する場合があります。
  最新の価格・在庫は各商品ページでご確認ください。
</div>

<div class="criteria-box">
  <strong>選定基準:</strong> 楽天市場のレビュー評価・件数などをもとにした人気度と、商品情報の確認結果を踏まえて掲載商品を選定しています。
</div>

<div class="product-grid">
${cards}
</div>

<h2>比較表</h2>
<div class="table-scroll">
<table>
<thead><tr><th>順位</th><th>商品名</th><th>価格</th><th>レビュー</th></tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>

<div class="guide-box">
  <strong>選び方:</strong> 価格・レビュー評価・確認できた特徴などを比較し、ライフスタイルやご予算に合わせてお選びください。
  持病がある場合や食事制限が必要な場合は、購入前に必ずかかりつけの獣医師にご相談ください。
</div>

<div class="caution-box">
  <strong>ご注意:</strong> 掲載しているレビュー評価は商品の人気度を示す参考情報であり、原材料・栄養成分・安全性を専門的に評価したものではありません。
  価格・在庫は変動する場合があるため、最新情報は各商品ページでご確認ください。本ページはslug「${escapeHtml(slug)}」の下書き(DRAFT)であり、公開ページではありません。
</div>
</main>
<footer>
<p>本サイトは楽天アフィリエイトプログラムを利用しています。</p>
</footer>
</body>
</html>
`;
}
