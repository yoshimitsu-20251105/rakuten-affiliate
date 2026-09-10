// 【2026-09-10 検索公開試験対応】generate-site.js の検索公開試験まわり(sitemap反映・
// ランキング一覧への内部リンク・robots meta同期・設定不正時のfail closed)の統合テスト。
// 実際のdocs/には一切書き込まない(隔離した一時ディレクトリへgenerate-site.js一式を
// コピーし、そこでnode generate-site.jsを実行する。generate-site.js自体は
// import.meta.url相対パスでdocs/を解決するため、コピー先で完全に隔離できる)。
// 外部API(楽天/Google/GA4/Search Console)は呼び出さない。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");

function makeItem(i) {
  return {
    itemCode: `test:item${i}`,
    itemName: `テスト商品${i}`,
    itemPrice: 1000 + i,
    itemUrl: "https://item.rakuten.co.jp/testshop/item/",
    catchcopy: "",
    reviewAverage: 4.5,
    reviewCount: 100,
    matchedKeyword: "テストジャンル",
  };
}

const MINIMAL_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>テスト試験公開ページ</title>
</head>
<body>test</body>
</html>
`;

const MINIMAL_PAGE_HTML_WITH_NOINDEX = MINIMAL_PAGE_HTML.replace(
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n',
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex,nofollow">\n'
);

async function setupIsolatedCopy() {
  const dir = await mkdtemp(join(tmpdir(), "generate-site-search-trial-test-"));
  await cp(join(PROJECT_ROOT, "generate-site.js"), join(dir, "generate-site.js"));
  await cp(join(PROJECT_ROOT, "lib"), join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "selected-products.json"), JSON.stringify([makeItem(1), makeItem(2), makeItem(3)], null, 2), "utf-8");
  await writeFile(join(dir, "articles-data.json"), "[]", "utf-8");
  await mkdir(join(dir, "docs", "rankings"), { recursive: true });
  await mkdir(join(dir, "keyword-research"), { recursive: true });
  return dir;
}

function runGenerateSite(dir) {
  return spawnSync(process.execPath, ["generate-site.js"], { cwd: dir, encoding: "utf-8" });
}

function validPage(overrides = {}) {
  return {
    slug: "senior-dog-pork",
    path: "rankings/senior-dog-pork.html",
    title: "テスト試験公開ページ",
    status: "search_trial",
    startDate: "2026-09-10",
    reviewDate: "2026-10-10",
    pageType: "search_trial_ranking",
    sitemapEnabled: true,
    internalLinkEnabled: true,
    searchIndexEnabled: true,
    ...overrides,
  };
}

async function writeSearchTrialConfig(dir, data) {
  await writeFile(join(dir, "keyword-research", "search-trial-pages.json"), JSON.stringify(data, null, 2), "utf-8");
}

test("generate-site.js: 検索公開試験ページの設定ファイルが存在しない場合は通常どおりサイト生成できる", async () => {
  const dir = await setupIsolatedCopy();
  try {
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, "docs", "sitemap.xml")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 設定ファイルのJSONが不正な場合は非ゼロ終了し、docs/への書き込みを一切行わない", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "keyword-research", "search-trial-pages.json"), "{ not valid json", "utf-8");
    const result = runGenerateSite(dir);
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(dir, "docs", "sitemap.xml")), "設定不正時はdocs/への書き込みを一切行わないこと");
    assert.ok(!existsSync(join(dir, "docs", "index.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 参照先HTMLが存在しない場合は非ゼロ終了し、docs/への書き込みを一切行わない", async () => {
  const dir = await setupIsolatedCopy();
  try {
    // わざとdocs/rankings/senior-dog-pork.htmlを作成しない
    await writeSearchTrialConfig(dir, { pages: [validPage()] });
    const result = runGenerateSite(dir);
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(dir, "docs", "index.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 有効な設定の場合、sitemap.xmlに対象URLが追加され、ランキング一覧に内部リンクが追加される", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage()] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);

    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.match(sitemap, /rankings\/senior-dog-pork\.html/);

    const allHtml = await readFile(join(dir, "docs", "rankings", "all.html"), "utf-8");
    assert.match(allHtml, /href="senior-dog-pork\.html"/);
    assert.match(allHtml, /テスト試験公開ページ/);
    // 既存のランキンググループ(テストジャンル)のセクションが壊れていないこと
    assert.match(allHtml, /テストジャンルおすすめランキング/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js実行後もランキング一覧の内部リンクは残る(2回実行しても消えない)", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage()] });
    assert.equal(runGenerateSite(dir).status, 0);
    assert.equal(runGenerateSite(dir).status, 0);
    const allHtml = await readFile(join(dir, "docs", "rankings", "all.html"), "utf-8");
    assert.match(allHtml, /href="senior-dog-pork\.html"/);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.match(sitemap, /rankings\/senior-dog-pork\.html/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: searchIndexEnabled:falseの場合、対象ページにnoindexを付与する", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage({ searchIndexEnabled: false })] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), "utf-8");
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: searchIndexEnabled:trueの場合、既存のnoindexを除去する(設定変更だけで検索インデックスを再開できる)", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML_WITH_NOINDEX, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage({ searchIndexEnabled: true })] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), "utf-8");
    assert.doesNotMatch(html, /noindex/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: sitemapEnabled:falseの場合、sitemap.xmlに追加しない(内部リンク・robotsには影響しない)", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage({ sitemapEnabled: false })] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.doesNotMatch(sitemap, /senior-dog-pork/);
    const allHtml = await readFile(join(dir, "docs", "rankings", "all.html"), "utf-8");
    assert.match(allHtml, /href="senior-dog-pork\.html"/, "内部リンクは影響を受けないこと");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: internalLinkEnabled:falseの場合、ランキング一覧に内部リンクを追加しない(sitemap・robotsには影響しない)", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage({ internalLinkEnabled: false })] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    const allHtml = await readFile(join(dir, "docs", "rankings", "all.html"), "utf-8");
    assert.doesNotMatch(allHtml, /senior-dog-pork/);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.match(sitemap, /senior-dog-pork/, "sitemapは影響を受けないこと");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 検索公開試験ページを追加しても、既存のランキンググループ(記事・全体ランキング)は壊れない", async () => {
  const dir = await setupIsolatedCopy();
  try {
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), MINIMAL_PAGE_HTML, "utf-8");
    await writeSearchTrialConfig(dir, { pages: [validPage()] });
    const result = runGenerateSite(dir);
    assert.equal(result.status, 0, result.stderr);
    // 通常の商品ベースのランキングページ(テストジャンル)が生成されていること
    assert.ok(existsSync(join(dir, "docs", "rankings", "テストジャンル.html")));
    const rankingHtml = await readFile(join(dir, "docs", "rankings", "テストジャンル.html"), "utf-8");
    assert.match(rankingHtml, /テスト商品1/);
    assert.match(rankingHtml, /テスト商品2/);
    assert.match(rankingHtml, /テスト商品3/);
    // 記事ページも生成されていること
    assert.ok(existsSync(join(dir, "docs", "articles", "test_item1.html")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 外部API呼び出しに使われるモジュール(googleapis等)をimportしない", async () => {
  const source = await readFile(join(PROJECT_ROOT, "generate-site.js"), "utf-8");
  assert.doesNotMatch(source, /googleapis/);
  assert.doesNotMatch(source, /fetch\(/);
});
