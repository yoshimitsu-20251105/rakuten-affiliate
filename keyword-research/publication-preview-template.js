// Phase 3B(公開前商品レビュー・収益化プレビュー)専用: 決定的なHTMLテンプレート生成(2026-09-07対応)。
// 外部生成AI(LLM)は一切呼び出さない。すべて固定の文言・構造とデータの埋め込みのみ。
// scriptタグ・外部トラッキングは追加しない。
//
// 【厳守・非公開情報】normalizedKeyword・WebKeywordScore・FinalPriority・source run・
// candidateSetHash・approvedFileHash・reviewHash・itemCode・slug・runId・
// Quality Score・ISO形式日時・内部理由コード・sellerのcatchcopy全文・内部ファイルパスは、
// このテンプレートへは一切渡さない設計にする(呼び出し側の責務)。念のため
// テンプレート自身もこれらのキーを受け取らない(引数にslugを含めない)。
// HTMLコメント・data属性にも内部情報を埋め込まない。
//
// 【厳守・表現】病気の治療・予防・健康効果を断定する表現は使わない。特定原材料が
// アレルギー対策になる等の断定をしない。持病・食事制限がある場合は獣医師へ相談する
// 旨を促す(医療的判断そのものは行わない)。「在庫あり」を将来まで保証する表現は使わない。
//
// 【2026-09-08 UI改善対応】既存サイト(docs/style.css)と同一の配色トークン・
// フォント・最大横幅を採用し、視覚的な統一感を持たせる。ただし generate-site.js の
// 生成処理そのものは一切呼び出さない・接続しない(値を静的に再利用するのみ)。

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

function formatSelectionType(selectionType) {
  return selectionType === "selectable" ? "選択式商品(購入時にタイプ選択)" : "固定商品(表示内容で確定)";
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
 *   title: string, introText: string, buyingGuideText: string,
 *   dataRetrievedAtJa: string,
 *   products: Array<{
 *     rank: number, displayName: string, displayNote?: string|null,
 *     imageUrl: string, itemPrice: number|null, reviewAverage: number|null, reviewCount: number|null,
 *     shopName?: string|null, selectionType: "confirmed"|"selectable",
 *     verifiedAttributeLabels: string[], affiliateUrl: string,
 *   }>,
 * }} data
 * @returns {string} 完全なHTML文書
 */
export function renderPublicationPreviewHtml(data) {
  const { title, introText, buyingGuideText, dataRetrievedAtJa, products } = data;

  const cards = products
    .map(
      (p) => `
      <article class="product-card">
        <div class="rank-badge">${p.rank}位</div>
        <div class="product-media">
          <img class="product-image" src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.displayName)}" width="200" height="200" loading="lazy">
        </div>
        <div class="product-info">
          <h3 class="product-name">${escapeHtml(p.displayName)}</h3>
          ${p.verifiedAttributeLabels.length > 0 ? `<ul class="product-attrs">${p.verifiedAttributeLabels.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` : ""}
          <dl class="product-specs">
            ${p.shopName ? `<div><dt>店舗</dt><dd>${escapeHtml(p.shopName)}</dd></div>` : ""}
            <div><dt>在庫</dt><dd>在庫確認済み(取得時点)</dd></div>
            <div><dt>購入方式</dt><dd>${escapeHtml(formatSelectionType(p.selectionType))}</dd></div>
          </dl>
          <p class="product-price">${formatPrice(p.itemPrice)}</p>
          <p class="product-review">レビュー: ${formatReview(p.reviewAverage, p.reviewCount)}</p>
          ${p.displayNote ? `<p class="product-note">※ ${escapeHtml(p.displayNote)}</p>` : ""}
          <a class="cta-button" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="sponsored noopener noreferrer">楽天市場で在庫・価格を確認してください</a>
        </div>
      </article>`
    )
    .join("\n");

  const tableRows = products
    .map(
      (p) => `
        <tr>
          <td data-label="順位">${p.rank}</td>
          <td data-label="商品名">${escapeHtml(p.displayName)}</td>
          <td data-label="価格">${formatPrice(p.itemPrice)}</td>
          <td data-label="レビュー">${formatReview(p.reviewAverage, p.reviewCount)}</td>
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
  :root { color-scheme: light dark; --bg:#fafaf8; --fg:#222; --card-bg:#fff; --border:#e2e2df; --accent:#bf0000; --accent-dark:#950000; --muted:#6a6a64; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1a1a1a; --fg:#eee; --card-bg:#262626; --border:#3a3a3a; --muted:#a3a39c; } }
  * { box-sizing: border-box; }
  html, body { max-width: 100%; overflow-x: hidden; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui,-apple-system,"Segoe UI","Hiragino Sans",sans-serif; line-height:1.7; }
  .draft-banner { background:var(--accent); color:#fff; text-align:center; padding:0.75rem 0.5rem; font-weight:bold; font-size:0.95rem; }
  header { padding:1.2rem 1.5rem; border-bottom:1px solid var(--border); }
  header .site-title { color:var(--fg); text-decoration:none; font-weight:bold; font-size:1.2rem; }
  main { max-width: 800px; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.3rem; line-height:1.5; }
  .ad-label { display:inline-block; background:var(--accent); color:#fff; border-radius:4px; padding:0.1rem 0.55rem; font-size:0.75rem; font-weight:bold; margin-right:0.5rem; vertical-align:middle; }
  .disclosure-box { background:var(--card-bg); border:1px solid var(--border); border-radius:8px; padding:0.9rem; margin:1rem 0; font-size:0.82rem; color:var(--muted); }
  .criteria-box { font-size:0.88rem; color:var(--muted); margin: 1rem 0; }
  .product-grid { display:flex; flex-direction:column; gap:0.85rem; margin: 1.25rem 0; }
  .product-card {
    position:relative;
    display:flex;
    flex-direction:row;
    align-items:flex-start;
    gap:1rem;
    background:var(--card-bg);
    border:1px solid var(--border);
    border-radius:12px;
    padding:0.9rem 0.9rem 0.9rem 0.9rem;
  }
  .rank-badge { position:absolute; top:0.5rem; left:0.5rem; background:var(--accent); color:#fff; border-radius:999px; padding:0.2rem 0.65rem; font-size:0.8rem; font-weight:bold; z-index:1; }
  .product-media { flex:0 0 200px; width:200px; max-width:200px; }
  .product-image { display:block; width:100%; height:200px; object-fit:contain; background:var(--bg); border-radius:8px; margin-top:1.6rem; }
  .product-info { flex:1 1 auto; min-width:0; }
  .product-name { font-size:0.98rem; margin: 1.6rem 0 0.4rem; word-break: break-word; }
  .product-attrs { list-style:none; padding:0; margin:0.4rem 0; display:flex; flex-wrap:wrap; gap:0.3rem; }
  .product-attrs li { background:rgba(128,128,128,0.12); border-radius:999px; padding:0.15rem 0.6rem; font-size:0.75rem; }
  .product-specs { margin:0.5rem 0; font-size:0.78rem; color:var(--muted); }
  .product-specs div { display:flex; gap:0.4rem; padding:0.1rem 0; }
  .product-specs dt { font-weight:bold; flex:0 0 auto; }
  .product-specs dd { margin:0; }
  .product-price { font-size:1.1rem; font-weight:bold; margin:0.3rem 0 0.1rem; }
  .product-review { font-size:0.85rem; color:var(--muted); margin:0.1rem 0; }
  .product-note { font-size:0.8rem; color:var(--accent); font-weight:bold; margin:0.5rem 0; }
  .cta-button { display:inline-block; margin-top:0.5rem; background:var(--accent); color:#fff; text-decoration:none; padding:0.7rem 1.4rem; border-radius:8px; font-weight:bold; font-size:0.9rem; max-width:100%; }
  .table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
  table { width:100%; border-collapse:collapse; background:var(--card-bg); font-size:0.82rem; }
  th, td { border:1px solid var(--border); padding:0.5rem; vertical-align:top; text-align:left; }
  th { background:rgba(128,128,128,0.08); }
  .guide-box, .caution-box { font-size:0.82rem; color:var(--muted); border-top:1px solid var(--border); margin-top:1.5rem; padding-top:1rem; }
  footer { max-width:800px; margin:0 auto; padding:1.2rem 1.5rem; border-top:1px solid var(--border); font-size:0.78rem; color:var(--muted); }
  @media (max-width: 640px) {
    .product-card { flex-direction:column; }
    .product-media { width:100%; max-width:220px; margin:0 auto; }
    .product-image { margin-top:0; }
    .product-name { margin-top:0.75rem; }
    .rank-badge { top:0.5rem; left:0.5rem; }
    table, thead, tbody, th, td, tr { display:block; }
    thead { display:none; }
    .table-scroll table { border:none; }
    tbody tr { margin-bottom:0.75rem; border:1px solid var(--border); border-radius:8px; padding:0.5rem 0.75rem; }
    td { border:none; padding:0.25rem 0; }
    td::before { content: attr(data-label); font-weight:bold; display:inline-block; width:5em; color:var(--muted); }
  }
  @media (max-width: 480px) {
    main { padding:1rem; }
  }
</style>
</head>
<body>
<div class="draft-banner">⚠ DRAFT — 公開前確認用ページ・検索エンジンには非公開(noindex) ⚠</div>
<header><a class="site-title" href="https://yoshimitsu-20251105.github.io/rakuten-affiliate/">楽天トレンドセレクト</a></header>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="hook">${escapeHtml(introText)}</p>

<div class="disclosure-box">
  <strong class="ad-label">広告・PR</strong>
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
  価格・在庫は変動する場合があるため、最新情報は各商品ページでご確認ください。
</div>
</main>
<footer>
<p>本サイトは楽天アフィリエイトプログラムを利用しています。紹介する商品は楽天市場のレビュー評価などをもとに人が内容を確認して選定しています。</p>
<p>運営者: 楽天トレンドセレクト運営チーム / 情報取得時点: ${escapeHtml(dataRetrievedAtJa)}</p>
</footer>
</body>
</html>
`;
}
