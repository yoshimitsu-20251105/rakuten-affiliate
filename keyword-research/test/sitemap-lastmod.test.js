// sitemap.xml の lastmod を「ページ内容が実際に変わった日」だけにする修正のテスト。
// 実際のdocs/には書き込まない(隔離した一時ディレクトリでgenerate-site.jsを実行する)。
// 外部API呼び出しは0件。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash, resolveLastmods, loadLastmodManifest } from "../../lib/sitemap-lastmod.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const TODAY = new Date().toISOString().slice(0, 10);

test("contentHash: 情報取得日・最終更新日の日付だけが違うHTMLは同じハッシュになる", () => {
  const a = "<p>情報取得日: 2026年10月11日(楽天市場)</p><p>運営者 / 最終更新日: 2026年10月11日</p><p>本文</p>";
  const b = "<p>情報取得日: 2026年10月12日(楽天市場)</p><p>運営者 / 最終更新日: 2026年10月12日</p><p>本文</p>";
  assert.equal(contentHash(a), contentHash(b));
});

test("contentHash: 日付以外の本文が違えば別のハッシュになる", () => {
  const a = "<p>最終更新日: 2026年10月11日</p><p>本文A</p>";
  const b = "<p>最終更新日: 2026年10月11日</p><p>本文B</p>";
  assert.notEqual(contentHash(a), contentHash(b));
});

test("resolveLastmods: 初回(前回記録なし)は実際の更新日が不明なためlastmodをnullにする", () => {
  const r = resolveLastmods([{ path: "a.html", hash: "h1" }], null, "2026-10-13");
  assert.deepEqual(r["a.html"], { hash: "h1", lastmod: null });
});

test("resolveLastmods: ハッシュが同じなら前回のlastmodを維持する(nullもそのまま)", () => {
  const prev = { "a.html": { hash: "h1", lastmod: "2026-10-01" }, "b.html": { hash: "h2", lastmod: null } };
  const r = resolveLastmods([{ path: "a.html", hash: "h1" }, { path: "b.html", hash: "h2" }], prev, "2026-10-13");
  assert.equal(r["a.html"].lastmod, "2026-10-01");
  assert.equal(r["b.html"].lastmod, null);
});

test("resolveLastmods: ハッシュが変わったURLと新規URLだけ当日になる", () => {
  const prev = { "a.html": { hash: "h1", lastmod: "2026-10-01" } };
  const r = resolveLastmods([{ path: "a.html", hash: "h1-changed" }, { path: "new.html", hash: "n1" }], prev, "2026-10-13");
  assert.equal(r["a.html"].lastmod, "2026-10-13");
  assert.equal(r["new.html"].lastmod, "2026-10-13");
});

test("resolveLastmods: sitemapから外れたURLの記録は引き継がない", () => {
  const prev = { "gone.html": { hash: "h", lastmod: "2026-10-01" } };
  const r = resolveLastmods([{ path: "a.html", hash: "h1" }], prev, "2026-10-13");
  assert.equal("gone.html" in r, false);
});

async function withManifest(content, fn) {
  const dir = await mkdtemp(join(tmpdir(), "lastmod-manifest-test-"));
  try {
    const file = join(dir, "sitemap-lastmod.json");
    if (content !== undefined) await writeFile(file, content, "utf-8");
    return await fn(new URL(`file:///${file.replace(/\\/g, "/")}`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadLastmodManifest: ファイルがなければnull(初回実行)", async () => {
  assert.equal(await withManifest(undefined, (u) => loadLastmodManifest(u)), null);
});

test("loadLastmodManifest: JSON不正・形式不正は例外を投げる", async () => {
  await assert.rejects(() => withManifest("{broken", (u) => loadLastmodManifest(u)), /JSONが不正/);
  await assert.rejects(() => withManifest(JSON.stringify({ "a.html": { hash: "h", lastmod: "10/01" } }), (u) => loadLastmodManifest(u)), /形式が不正/);
  await assert.rejects(() => withManifest(JSON.stringify({ "a.html": { hash: 1, lastmod: null } }), (u) => loadLastmodManifest(u)), /形式が不正/);
});

// ---- generate-site.js 統合テスト ----

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

const TRIAL_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>テスト試験公開ページ</title>
</head>
<body>test</body>
</html>
`;

async function setup(items) {
  const dir = await mkdtemp(join(tmpdir(), "sitemap-lastmod-test-"));
  await cp(join(PROJECT_ROOT, "generate-site.js"), join(dir, "generate-site.js"));
  await cp(join(PROJECT_ROOT, "lib"), join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "selected-products.json"), JSON.stringify(items, null, 2), "utf-8");
  await writeFile(join(dir, "articles-data.json"), "[]", "utf-8");
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

function lastmodOf(sitemap, pathPart) {
  const m = sitemap.match(new RegExp(`<url><loc>[^<]*${pathPart}</loc>(<lastmod>([^<]*)</lastmod>)?</url>`));
  assert.ok(m, `sitemapに${pathPart}が見つかりません`);
  return m[2] ?? null;
}

test("generate-site.js: 初回はlastmodを出力せず、sitemap-lastmod.jsonに記録する", async () => {
  const dir = await setup([makeItem(1), makeItem(2), makeItem(3)]);
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.doesNotMatch(sitemap, /<lastmod>/);
    assert.match(sitemap, /<loc>[^<]*rankings\/senior-dog-pork\.html<\/loc>/);
    const manifest = JSON.parse(await readFile(join(dir, "sitemap-lastmod.json"), "utf-8"));
    assert.equal(manifest["rankings/senior-dog-pork.html"].lastmod, null);
    assert.equal(typeof manifest["index.html"].hash, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 2回目は内容が変わっていない試験ページのlastmodを付けず、新規記事だけ当日になる", async () => {
  const dir = await setup([makeItem(1), makeItem(2), makeItem(3)]);
  try {
    assert.equal(run(dir).status, 0);
    await writeFile(join(dir, "selected-products.json"), JSON.stringify([makeItem(4)]), "utf-8");
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.equal(lastmodOf(sitemap, "rankings\\/senior-dog-pork\\.html"), null);
    assert.equal(lastmodOf(sitemap, "articles\\/test_item4\\.html"), TODAY);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 何も変わらない再実行ではlastmodが全て変わらない", async () => {
  const dir = await setup([makeItem(1), makeItem(2), makeItem(3)]);
  try {
    assert.equal(run(dir).status, 0);
    const first = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    await writeFile(join(dir, "selected-products.json"), "[]", "utf-8");
    assert.equal(run(dir).status, 0);
    assert.equal(await readFile(join(dir, "docs", "sitemap.xml"), "utf-8"), first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: 試験ページのファイル内容が変わった場合だけ、そのページのlastmodが当日になる", async () => {
  const dir = await setup([makeItem(1), makeItem(2), makeItem(3)]);
  try {
    assert.equal(run(dir).status, 0);
    await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), TRIAL_PAGE_HTML.replace("test</body>", "test2</body>"), "utf-8");
    await writeFile(join(dir, "selected-products.json"), "[]", "utf-8");
    assert.equal(run(dir).status, 0);
    const sitemap = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.equal(lastmodOf(sitemap, "rankings\\/senior-dog-pork\\.html"), TODAY);
    assert.equal(lastmodOf(sitemap, "articles\\/test_item1\\.html"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generate-site.js: sitemap-lastmod.jsonが不正な場合は非ゼロ終了し、docs/のページを書き込まない", async () => {
  const dir = await setup([makeItem(1), makeItem(2), makeItem(3)]);
  try {
    await writeFile(join(dir, "sitemap-lastmod.json"), "{broken", "utf-8");
    const r = run(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /sitemap-lastmod\.json/);
    assert.equal(existsSync(join(dir, "docs", "sitemap.xml")), false);
    assert.equal(existsSync(join(dir, "docs", "articles")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
