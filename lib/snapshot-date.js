// 商品データの取得日(snapshotDate)の扱い。
// 生成日(実行日)を「商品情報の取得日」「最終更新日」として表示しないための補助関数。
//  - snapshotDate: 取得日を証明できる商品だけが持つ(日本時間のYYYY-MM-DD)
//  - estimatedSnapshotDate: 取得日を証明できない商品の、git初回追加日(日本時間)。内部記録専用で、
//    取得日としては表示しない(公開時期の目安として「○年○月に公開した時点」の表示にだけ使う)

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** UTCの時刻を日本時間のYYYY-MM-DDにする(UTC日付をそのまま使わない)。 */
export function toJstIsoDate(date) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseIso(iso) {
  const m = typeof iso === "string" ? ISO_DATE_RE.exec(iso) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** "2026-08-25" → "2026年8月25日"。形式が不正なら null。 */
export function formatJapaneseDate(iso) {
  const p = parseIso(iso);
  return p ? `${p.y}年${p.m}月${p.d}日` : null;
}

/** "2026-08-25" → "2026年8月"。形式が不正なら null。 */
export function formatJapaneseMonth(iso) {
  const p = parseIso(iso);
  return p ? `${p.y}年${p.m}月` : null;
}

/**
 * 記事ページの「商品情報の取得日」表示(HTML)。
 * snapshotDateがある場合だけ取得日を表示する。ない場合は取得日を断定しない。
 */
export function snapshotNoticeHtml(item) {
  const source = "(楽天市場の商品情報をもとに作成)";
  const date = formatJapaneseDate(item.snapshotDate);
  if (date) {
    return `<p class="provenance">商品情報の取得日: ${date}<br>価格・在庫・レビュー件数はその時点の情報です。${source}</p>`;
  }
  const month = formatJapaneseMonth(item.estimatedSnapshotDate);
  const when = month ? `${month}に公開した時点、またはそれ以前の情報です。` : "公開した時点、またはそれ以前の情報です。";
  return `<p class="provenance">商品情報の取得日の記録がありません。${when}現在の価格・在庫・レビューと異なる場合があります。${source}</p>`;
}
