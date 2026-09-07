// Phase 3A(非公開下書きページ生成)専用: 決定的なHTMLテンプレート生成。
// 外部生成AI(LLM)は一切呼び出さない。すべて固定の文言・構造とデータの埋め込みのみ。
//
// 【厳守】
// - 病気の治療・予防・健康効果を断定する表現は使わない。
// - 「グレインフリーの方が健康によい」等、根拠のない優良性を断定しない。
// - 特定原材料(豚肉等)がアレルギー対策になる等の断定をしない。
// - 商品データ(itemName/catchcopy)に無い属性・原材料・原産国等を推定して書かない
//   (確認できた属性は、楽天照合層(rakuten-match.js)が実際に確認したmatchedAttributesの
//   みを表示する)。
//
// 【2026-09-07 PR#5監査対応】
// - catchcopy(販売者が書いた文言。医療・健康表現を含む可能性がある)はランキング表に
//   必須ではないため表示から削除した。安全確認は呼び出し側(pilot-draft-build.js)が
//   itemName+catchcopyに対して行うが、catchcopy自体はこのテンプレートへ渡っても
//   出力しない。
// - 本ページには現時点でクリック可能なリンクが存在しないため、「アフィリエイト広告を
//   含みます」という事実と異なる開示文言は使わない(公開時に使用予定である旨へ変更)。
// - eligibleItemsに渡す配列は、呼び出し側で安全確認・数値検証・上位3〜5件への絞込み
//   (Quality Score降順)を済ませたもの(pageReadyItems)を渡すこと。このテンプレート
//   自身は表示件数の絞込み(defense-in-depthとしてのslice)以上のゲート判定は行わない。

const ATTRIBUTE_LABELS = {
  "species:dog": "犬用",
  "species:cat": "猫用",
  "lifeStage:puppy": "子犬向け",
  "lifeStage:kitten": "子猫向け",
  "lifeStage:senior": "シニア向け",
  "lifeStage:adult": "成犬・成猫向け",
  "productType:staple": "主食",
  "productType:treat": "おやつ",
  "productType:dry": "ドライタイプ",
  "productType:wet": "ウェットタイプ",
  "feature:domestic": "国産",
  "feature:additive-free": "無添加",
  "feature:grain-free": "グレインフリー",
  "feature:small-bite": "小粒",
  "purchaseCondition:small-pack": "小分け・お試しサイズ",
  "purchaseCondition:bulk": "まとめ買い・大容量",
  "purchaseCondition:free-shipping": "送料無料",
};

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

function attributeLabels(tags) {
  return (tags ?? []).map((t) => ATTRIBUTE_LABELS[t] ?? t);
}

/**
 * @param {{
 *   title: string, slug: string, normalizedKeyword: string, originalKeyword: string,
 *   cluster: string, monthlySearches: string|number, finalPriority: number,
 *   webKeywordScoreTotal: number, eligibleItems: Array<{itemCode:string,itemName:string,
 *     itemPrice:number|null,reviewAverage:number|null,reviewCount:number|null,
 *     itemUrl:string,affiliateUrl:string,qualityScore:number}>,
 *   requiredAttributeLabels: string[], dataRetrievedAt: string, sourceRunId: string,
 * }} data - eligibleItemsは呼び出し側(pilot-draft-build.js)で安全確認・数値検証・
 *   件数絞込み(3〜5件、Quality Score降順)を済ませたもの(pageReadyItems)を渡すこと。
 *   catchcopy(seller文言)はこのテンプレートへ渡しても表示しない。
 * @returns {string} 完全なHTML文書
 */
export function renderPilotDraftHtml(data) {
  const {
    title,
    slug,
    normalizedKeyword,
    originalKeyword,
    cluster,
    monthlySearches,
    finalPriority,
    webKeywordScoreTotal,
    eligibleItems,
    requiredAttributeLabels,
    dataRetrievedAt,
    sourceRunId,
  } = data;

  const topItems = eligibleItems.slice(0, 5); // 表示は上位5件までに絞る(最低3件以上を保証するのは呼び出し側のゲート)

  const rows = topItems
    .map(
      (item, i) => `
        <tr>
          <td class="rank-cell">${i + 1}</td>
          <td class="name-cell">${escapeHtml(item.itemName)}</td>
          <td class="price-cell">${formatPrice(item.itemPrice)}</td>
          <td class="review-cell">${formatReview(item.reviewAverage, item.reviewCount)}</td>
          <td class="score-cell">${escapeHtml(String(item.qualityScore))}<span class="score-max">/100点</span></td>
        </tr>`
    )
    .join("\n");

  const attrList = requiredAttributeLabels.length > 0
    ? `<ul class="attr-list">${requiredAttributeLabels.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`
    : `<p class="attr-none">この検索語に紐づく必須属性は抽出されませんでした。</p>`;

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
  body { margin:0; background:var(--bg); color:var(--fg); font-family: system-ui,-apple-system,"Segoe UI","Hiragino Sans",sans-serif; line-height:1.7; }
  .draft-banner { background:var(--accent); color:#fff; text-align:center; padding:0.8rem; font-weight:bold; font-size:1rem; }
  main { max-width: 760px; margin: 0 auto; padding: 1.25rem; }
  h1 { font-size: 1.3rem; }
  .meta-box { background:var(--card-bg); border:1px dashed var(--accent); border-radius:8px; padding:1rem; margin-bottom:1.5rem; font-size:0.85rem; color:var(--muted); }
  .table-scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; background:var(--card-bg); }
  th, td { border:1px solid var(--border); padding:0.6rem; font-size:0.85rem; vertical-align:top; }
  th { background:rgba(128,128,128,0.08); }
  .attr-list { padding-left:1.2rem; }
  .disclosure { font-size:0.78rem; color:var(--muted); border-top:1px solid var(--border); margin-top:2rem; padding-top:1rem; }
  @media (max-width: 480px) {
    th, td { font-size:0.75rem; padding:0.4rem; }
    main { padding:0.75rem; }
  }
</style>
</head>
<body>
<div class="draft-banner">⚠ DRAFT・非公開ページ(承認済みだが未掲載、社内試験用) ⚠</div>
<main>
<h1>${escapeHtml(title)}</h1>
<p class="hook">この記事は、Googleキーワードプランナーの実需要データと楽天商品照合結果をもとに機械的に生成された下書きです。対象読者: この検索語で情報を探している飼い主の方。</p>

<div class="meta-box">
  <strong>選定基準・データ出所(下書き生成メタ情報)</strong><br>
  normalizedKeyword: ${escapeHtml(normalizedKeyword)}(元表記: ${escapeHtml(originalKeyword)})<br>
  クラスター: ${escapeHtml(cluster || "(分類なし)")}<br>
  月間検索数(Googleキーワードプランナー実データ): ${escapeHtml(String(monthlySearches))}<br>
  WebKeywordScore: ${escapeHtml(String(webKeywordScoreTotal))} / FinalPriority: ${escapeHtml(String(finalPriority))}<br>
  選定方法: 需要データ(検索ボリューム・購入意図)と楽天商品照合(必須属性の一致)を組み合わせたスコアリングにより選定。既存Quality Score(レビュー評価・件数・リピート性の代理指標)で商品を順位付け。<br>
  情報取得日時(楽天商品データ取得時点): ${escapeHtml(dataRetrievedAt)}<br>
  source run: ${escapeHtml(sourceRunId)}
</div>

<h2>確認できた属性(楽天商品データで実際に確認済み)</h2>
${attrList}

<h2>商品比較</h2>
<div class="table-scroll">
<table>
<thead><tr><th>順位</th><th>商品名</th><th>価格</th><th>レビュー</th><th>Quality Score</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>

<p class="caution">
  <strong>ご注意:</strong> 上記のQuality Scoreはレビュー評価・件数・リピート性をもとにした独自の人気度指標であり、
  原材料・栄養成分・安全性を専門的に評価したものではありません。特定の原材料や製法が健康上の効果を持つ、
  疾患の治療・予防になる、といった保証をするものではありません。価格・在庫は変動する場合があるため、
  最新情報は各商品ページでご確認ください。
</p>

<p class="disclosure">
  本ページは下書き(DRAFT)であり、クリック可能な商品リンクはまだ設置していません。
  公開時には楽天アフィリエイトリンクを使用する予定です。
  掲載している価格・レビュー情報は${escapeHtml(dataRetrievedAt)}時点で取得したものであり、
  その後価格・在庫状況が変動する場合があります。本ページはslug「${escapeHtml(slug)}」の下書きであり、公開ページではありません。
</p>
</main>
</body>
</html>
`;
}
