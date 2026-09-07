// 【2026-09-07 Phase 3A対応】決定的HTMLテンプレート生成のテスト。
// DRAFT表示・noindex,nofollow・レスポンシブ対応・禁止表現の非出力を検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPilotDraftHtml } from "../pilot-draft-template.js";

function baseData(overrides = {}) {
  return {
    title: "シニア犬向け豚肉ドッグフードおすすめランキング比較",
    slug: "senior-dog-pork",
    normalizedKeyword: "シニア 犬 豚肉",
    originalKeyword: "シニア 犬 豚肉",
    cluster: "シニア犬フード",
    monthlySearches: 500,
    finalPriority: 77,
    webKeywordScoreTotal: 74,
    eligibleItems: [
      { itemCode: "shop:1", itemName: "国産シニア犬用 豚肉ドッグフード", catchcopy: "国産豚肉使用", itemPrice: 3980, reviewAverage: 4.6, reviewCount: 320, itemUrl: "https://item.rakuten.co.jp/shop/1/", affiliateUrl: "https://hb.afl.rakuten.co.jp/aff/1", qualityScore: 82 },
      { itemCode: "shop:2", itemName: "シニア犬用 豚肉フード", catchcopy: "", itemPrice: 2980, reviewAverage: 4.3, reviewCount: 150, itemUrl: "https://item.rakuten.co.jp/shop/2/", affiliateUrl: "https://hb.afl.rakuten.co.jp/aff/2", qualityScore: 70 },
      { itemCode: "shop:3", itemName: "老犬 豚肉入りドッグフード", catchcopy: "", itemPrice: 1980, reviewAverage: 4.1, reviewCount: 80, itemUrl: "https://item.rakuten.co.jp/shop/3/", affiliateUrl: "https://hb.afl.rakuten.co.jp/aff/3", qualityScore: 60 },
    ],
    requiredAttributeLabels: ["犬用", "シニア向け"],
    dataRetrievedAt: "2026-09-06T04:45:11.364Z",
    sourceRunId: "live-2026-09-06",
    ...overrides,
  };
}

test("DRAFT・非公開のバナーが表示される", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /DRAFT・非公開/);
});

test("noindex,nofollowが設定される", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
});

test("titleに【下書き・非公開】が付与される", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /<title>【下書き・非公開】/);
});

test("レスポンシブ対応(viewport meta・メディアクエリ)が含まれる", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /@media \(max-width: 480px\)/);
});

test("上位3商品以上の比較表が生成される(商品名・価格・レビュー・Quality Score)", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /国産シニア犬用 豚肉ドッグフード/);
  assert.match(html, /¥3,980/);
  assert.match(html, /4\.60 \(320件\)/);
  assert.match(html, />82</); // Quality Score
});

test("確認できた属性(matchedAttributesのラベル)が表示される", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /犬用/);
  assert.match(html, /シニア向け/);
});

test("情報取得日時が表示される", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /2026-09-06T04:45:11\.364Z/);
});

test("【監査対応】公開時にアフィリエイトリンクを使用予定である旨、価格・在庫変動の注意書きが含まれる", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.match(html, /公開時には楽天アフィリエイトリンクを使用する予定です/);
  assert.match(html, /価格・在庫/);
});

test("【監査対応】現時点でクリック可能なリンクが存在しないため、「本ページのリンクにはアフィリエイト広告を含みます」という事実と異なる表現は使わない", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.doesNotMatch(html, /本ページのリンクにはアフィリエイト広告を含みます/);
});

test("【監査対応・回帰テスト15】seller由来のcatchcopyはHTMLへ一切出力されない(ランキング表に不要なため削除済み)", () => {
  const html = renderPilotDraftHtml(
    baseData({
      eligibleItems: [
        { itemCode: "shop:1", itemName: "テスト商品", catchcopy: "これは絶対に出力されてはいけない販売者コピーABC999", itemPrice: 1000, reviewAverage: 4.0, reviewCount: 10, qualityScore: 50 },
      ],
    })
  );
  assert.doesNotMatch(html, /ABC999/);
  assert.doesNotMatch(html, /class="catchcopy"/);
});

test("禁止表現(治療・予防等の医療効果を断定する肯定文)が出力に含まれない", () => {
  // テンプレート自身の免責文(「治療・予防になる、といった保証をするものでは
  // ありません」)は治療・予防を明示的に否定する安全な表現であり、禁止対象ではない。
  // ここで確認したいのは、断定的な肯定表現(「治ります」「予防できます」「効果が
  // あります」等)が出力されていないことである。
  const html = renderPilotDraftHtml(baseData());
  for (const banned of ["治ります", "予防できます", "改善します", "効果があります", "治療できます"]) {
    assert.doesNotMatch(html, new RegExp(banned), `禁止表現「${banned}」が含まれていないこと`);
  }
  // 免責文が実際に否定形で書かれていることも確認する(肯定断定ではないことの裏付け)
  assert.match(html, /治療・予防になる、といった保証をするものではありません/);
});

test("禁止表現(根拠のない優良性断定: 健康による/おすすめの理由の断定)が出力に含まれない", () => {
  const html = renderPilotDraftHtml(baseData());
  assert.doesNotMatch(html, /健康に良い/);
  assert.doesNotMatch(html, /アレルギー対策になります/);
});

test("商品データに無い属性を推定しない(requiredAttributeLabelsが空の場合、根拠のない属性を出力しない)", () => {
  const html = renderPilotDraftHtml(baseData({ requiredAttributeLabels: [] }));
  assert.match(html, /必須属性は抽出されませんでした/);
});

test("HTML特殊文字(商品名内の<>&等)は適切にエスケープされる", () => {
  const html = renderPilotDraftHtml(
    baseData({
      eligibleItems: [
        { itemCode: "shop:1", itemName: '<script>alert("xss")</script>', catchcopy: "A&B", itemPrice: 1000, reviewAverage: 4.0, reviewCount: 10, qualityScore: 50 },
      ],
    })
  );
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("上位5件までに表示を絞る(6件以上渡しても最初の5件のみ表示)", () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    itemCode: `shop:${i}`,
    itemName: `商品${i}`,
    catchcopy: "",
    itemPrice: 1000 + i,
    reviewAverage: 4.0,
    reviewCount: 10,
    qualityScore: 90 - i,
  }));
  const html = renderPilotDraftHtml(baseData({ eligibleItems: items }));
  for (let i = 0; i <= 4; i++) assert.match(html, new RegExp(`商品${i}`));
  for (let i = 5; i <= 7; i++) assert.doesNotMatch(html, new RegExp(`商品${i}`));
});

test("価格・レビュー情報が無い商品は「情報なし」と表示される(捏造しない)", () => {
  const html = renderPilotDraftHtml(
    baseData({
      eligibleItems: [{ itemCode: "shop:1", itemName: "情報不足商品", catchcopy: "", itemPrice: null, reviewAverage: null, reviewCount: null, qualityScore: 0 }],
    })
  );
  assert.match(html, /価格情報なし/);
  assert.match(html, /レビュー情報なし/);
});
