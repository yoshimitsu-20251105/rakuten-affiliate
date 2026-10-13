// 商品データ鮮度表示の修正のテスト(Implementation Brief: brief-2026-10-13-product-data-freshness-disclosure)。
//  - 生成日(今日)を「商品情報の取得日」「最終更新日」として表示しない
//  - 取得日を証明できる商品(snapshotDate)だけ取得日を表示し、証明できない商品(estimatedSnapshotDate)は
//    取得日として表示しない
//  - 日付は日本時間(UTC/JST境界)
//  - 自動生成商品ページ(docs/articles/)のProduct JSON-LDを出力しない(ランキングページのFAQ構造化データ・
//    検索公開試験ページは変更しない)
// 実際のdocs/には書き込まない(隔離した一時ディレクトリでgenerate-site.jsを実行する)。外部API呼び出しは0件。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toJstIsoDate, formatJapaneseDate, formatJapaneseMonth, snapshotNoticeHtml } from "../../lib/snapshot-date.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

test("toJstIsoDate: UTCの夜(日本時間の翌日朝)は日本時間の日付になる", () => {
  assert.equal(toJstIsoDate(new Date("2026-09-15T22:19:34Z")), "2026-09-16");
});

test("toJstIsoDate: UTC 14:59:59 は同日、15:00:00 は日本時間の翌日(境界)", () => {
  assert.equal(toJstIsoDate(new Date("2026-10-12T14:59:59Z")), "2026-10-12");
  assert.equal(toJstIsoDate(new Date("2026-10-12T15:00:00Z")), "2026-10-13");
});

test("toJstIsoDate: 年またぎも日本時間で判定する", () => {
  assert.equal(toJstIsoDate(new Date("2026-12-31T15:00:00Z")), "2027-01-01");
});

test("formatJapaneseDate / formatJapaneseMonth: ISO日付を日本語表記にし、不正値はnull", () => {
  assert.equal(formatJapaneseDate("2026-08-07"), "2026年8月7日");
  assert.equal(formatJapaneseMonth("2026-08-17"), "2026年8月");
  assert.equal(formatJapaneseDate("2026/08/07"), null);
  assert.equal(formatJapaneseDate(undefined), null);
});

test("snapshotNoticeHtml: snapshotDateがあれば取得日を表示する", () => {
  const html = snapshotNoticeHtml({ snapshotDate: "2026-08-27" });
  assert.match(html, /商品情報の取得日: 2026年8月27日/);
  assert.match(html, /価格・在庫・レビュー件数はその時点の情報です/);
});

test("snapshotNoticeHtml: estimatedSnapshotDateだけの商品は取得日として表示しない(公開時期の目安だけ表示)", () => {
  const html = snapshotNoticeHtml({ estimatedSnapshotDate: "2026-08-17" });
  assert.doesNotMatch(html, /商品情報の取得日: /);
  assert.doesNotMatch(html, /8月17日/);
  assert.match(html, /商品情報の取得日の記録がありません/);
  assert.match(html, /2026年8月に公開した時点、またはそれ以前の情報です/);
  assert.match(html, /現在の価格・在庫・レビューと異なる場合があります/);
});

test("snapshotNoticeHtml: どちらも持たない商品も取得日を断定しない", () => {
  const html = snapshotNoticeHtml({});
  assert.doesNotMatch(html, /商品情報の取得日: /);
  assert.match(html, /取得日の記録がありません/);
  assert.match(html, /公開した時点、またはそれ以前の情報です/);
});

test("snapshotNoticeHtml: snapshotDateとestimatedSnapshotDateの両方があればsnapshotDateだけを使う", () => {
  const html = snapshotNoticeHtml({ snapshotDate: "2026-09-01", estimatedSnapshotDate: "2026-08-17" });
  assert.match(html, /商品情報の取得日: 2026年9月1日/);
  assert.doesNotMatch(html, /8月17日/);
});

// ---- generate-site.js 統合テスト ----

function makeItem(i, extra = {}) {
  return {
    itemCode: `test:item${i}`,
    itemName: `テスト商品${i}`,
    itemPrice: 1000 + i,
    itemUrl: `https://item.rakuten.co.jp/testshop/item${i}/`,
    catchcopy: "",
    reviewAverage: 4.5,
    reviewCount: 100,
    matchedKeyword: "テストジャンル",
    ...extra,
  };
}

const TRIAL_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>テスト試験公開ページ</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"試験ページ用"}</script>
</head>
<body>test</body>
</html>
`;

async function setup({ existing, selected }) {
  const dir = await mkdtemp(join(tmpdir(), "product-data-freshness-test-"));
  await cp(join(PROJECT_ROOT, "generate-site.js"), join(dir, "generate-site.js"));
  await cp(join(PROJECT_ROOT, "lib"), join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "selected-products.json"), JSON.stringify(selected, null, 2), "utf-8");
  await writeFile(join(dir, "articles-data.json"), JSON.stringify(existing, null, 2), "utf-8");
  await mkdir(join(dir, "docs", "rankings"), { recursive: true });
  await mkdir(join(dir, "keyword-research"), { recursive: true });
  await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), TRIAL_PAGE_HTML, "utf-8");
  await writeFile(
    join(dir, "keyword-research", "search-trial-pages.json"),
    JSON.stringify({
      pages: [{
        slug: "senior-dog-pork", path: "rankings/senior-dog-pork.html", title: "テスト試験公開ページ", status: "search_trial",
        startDate: "2026-09-10", reviewDate: "2026-10-10", pageType: "search_trial_ranking",
        sitemapEnabled: true, internalLinkEnabled: true, searchIndexEnabled: true,
      }],
    }),
    "utf-8"
  );
  return dir;
}

const run = (dir) => spawnSync(process.execPath, ["generate-site.js"], { cwd: dir, encoding: "utf-8" });
const article = (dir, i) => readFile(join(dir, "docs", "articles", `test_item${i}.html`), "utf-8");

test("generate-site.js: 記事ページの取得日はsnapshotDate由来で、estimatedSnapshotDateは取得日として表示されない", async () => {
  const existing = [
    makeItem(1, { snapshotDate: "2026-08-27" }),
    makeItem(2, { estimatedSnapshotDate: "2026-08-17" }),
    makeItem(3, { snapshotDate: "2026-09-16" }),
  ];
  const dir = await setup({ existing, selected: [] });
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(await article(dir, 1), /商品情報の取得日: 2026年8月27日/);
    const b = await article(dir, 2);
    assert.doesNotMatch(b, /商品情報の取得日: /);
    assert.match(b, /商品情報の取得日の記録がありません。2026年8月に公開した時点、またはそれ以前の情報です/);
    assert.doesNotMatch(b, /2026年8月17日/);
    assert.match(await article(dir, 3), /商品情報の取得日: 2026年9月16日/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 新規商品のsnapshotDateは日本時間の日付で記録され、表示される", async () => {
  const dir = await setup({ existing: [makeItem(1, { snapshotDate: "2026-08-27" })], selected: [makeItem(2), makeItem(3)] });
  try {
    const before = new Date();
    const r = run(dir);
    const after = new Date();
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(await readFile(join(dir, "articles-data.json"), "utf-8"));
    const added = data.find((a) => a.itemCode === "test:item2");
    assert.ok([toJstIsoDate(before), toJstIsoDate(after)].includes(added.snapshotDate), `snapshotDate=${added.snapshotDate}`);
    assert.equal(added.estimatedSnapshotDate, undefined);
    assert.match(await article(dir, 2), new RegExp(`商品情報の取得日: ${formatJapaneseDate(added.snapshotDate)}`));
    // 既存商品のsnapshotDateは上書きされない
    assert.equal(data.find((a) => a.itemCode === "test:item1").snapshotDate, "2026-08-27");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 生成日を「情報取得日」「最終更新日」として表示しない(記事・ランキング・トップ)", async () => {
  const dir = await setup({ existing: [makeItem(1, { snapshotDate: "2026-08-27" }), makeItem(2, { estimatedSnapshotDate: "2026-08-17" }), makeItem(3, { snapshotDate: "2026-09-16" })], selected: [] });
  try {
    assert.equal(run(dir).status, 0);
    const pages = [await article(dir, 1), await article(dir, 2), await readFile(join(dir, "docs", "index.html"), "utf-8")];
    const rankingFiles = ["テストジャンル.html"];
    for (const f of rankingFiles) pages.push(await readFile(join(dir, "docs", "rankings", f), "utf-8"));
    pages.push(await readFile(join(dir, "docs", "rankings", "all.html"), "utf-8"));
    const now = new Date();
    const todayStrings = [now, new Date(now.getTime() + 9 * 3600e3)].map((d) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`);
    for (const html of pages) {
      assert.doesNotMatch(html, /最終更新日/);
      assert.doesNotMatch(html, /情報取得日/);
      for (const t of todayStrings) assert.equal(html.includes(t), false, `生成日 ${t} が表示されています`);
      assert.match(html, /運営者: 楽天トレンドセレクト運営チーム/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 記事ページからProduct JSON-LD(offers・availability・aggregateRating)が消え、ランキングページのFAQ構造化データは残る", async () => {
  const dir = await setup({ existing: [makeItem(1), makeItem(2), makeItem(3)], selected: [] });
  try {
    assert.equal(run(dir).status, 0);
    for (const i of [1, 2, 3]) {
      const html = await article(dir, i);
      assert.doesNotMatch(html, /application\/ld\+json/);
      assert.doesNotMatch(html, /schema\.org\/InStock|"offers"|aggregateRating|"@type":"Product"/);
      // 可視HTMLの商品名・価格・レビュー表示とCTA(affiliate URL)は変更しない
      assert.match(html, new RegExp(`テスト商品${i}`));
      assert.match(html, new RegExp(`¥${(1000 + i).toLocaleString()}`));
      assert.match(html, /⭐ 4\.5 <span class="social-proof-count">100件のレビュー<\/span>/);
      assert.match(html, new RegExp(`href="https://item\\.rakuten\\.co\\.jp/testshop/item${i}/"`));
    }
    const ranking = await readFile(join(dir, "docs", "rankings", "テストジャンル.html"), "utf-8");
    assert.match(ranking, /application\/ld\+json/);
    assert.match(ranking, /"@type":"FAQPage"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 検索公開試験ページ(JSON-LDを含む)は一切変更されない", async () => {
  const dir = await setup({ existing: [makeItem(1, { snapshotDate: "2026-08-27" }), makeItem(2), makeItem(3)], selected: [] });
  try {
    assert.equal(run(dir).status, 0);
    assert.equal(await readFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), "utf-8"), TRIAL_PAGE_HTML);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
