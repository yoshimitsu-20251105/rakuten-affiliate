// Article Growth Freeze(brief-2026-10-13-article-growth-freeze)のテスト。
//  - ARTICLE_GROWTH_FROZEN = true: 楽天APIを呼ばず、環境変数のチェックより前に、何も書き込まずに終了コード0で終了する
//  - false: 従来どおり動作する(再開は定数の切り替えだけ)
//  - freeze状態で、登録済み商品だけの selected-products.json が残っていても、generate-site.js は記事を増やさない
//  - 検索公開試験ページは変更されない
// 実際のリポジトリのデータには触れない(隔離した一時ディレクトリで実行する)。楽天APIには接続しない
// (globalThis.fetch を差し替え、呼び出し回数を数える。setTimeout の待機も短縮する)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const FROZEN_LINE = "const ARTICLE_GROWTH_FROZEN = true;";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const STUB = `
import fs from "node:fs";
const log = process.env.FETCH_LOG;
const item = (code) => ({ Item: { itemCode: code, itemName: "定期便 テスト商品", catchcopy: "", itemPrice: 9000, reviewCount: 100, reviewAverage: 4.5, itemUrl: "https://item.rakuten.co.jp/t/" + code + "/" } });
globalThis.fetch = async (url) => {
  fs.appendFileSync(log, String(url) + "\\n");
  return { json: async () => ({ Items: String(url).includes("Ranking") ? [] : [item("stubshop:1"), item("stubshop:2")] }) };
};
const orig = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => orig(fn, 0, ...a);
`;

async function setup({ frozen }) {
  const dir = await mkdtemp(join(tmpdir(), "select-products-freeze-test-"));
  const src = await readFile(join(PROJECT_ROOT, "select-products.js"), "utf-8");
  assert.ok(src.includes(FROZEN_LINE), "select-products.js に現在の凍結定数(true)が見つかりません。再開した後は、このテストの前提(FROZEN_LINE)を確認してください");
  await writeFile(join(dir, "select-products.js"), frozen ? src : src.replace(FROZEN_LINE, "const ARTICLE_GROWTH_FROZEN = false;"), "utf-8");
  await writeFile(join(dir, "stub.mjs"), STUB, "utf-8");
  const data = {
    "selected-products.json": JSON.stringify([{ itemCode: "sentinel:selected" }], null, 2),
    "posted-history.json": JSON.stringify(["sentinel:history"], null, 2),
    "articles-data.json": JSON.stringify([{ itemCode: "sentinel:article" }], null, 2),
  };
  for (const [f, c] of Object.entries(data)) await writeFile(join(dir, f), c, "utf-8");
  return { dir, data };
}

function runSelect(dir, env = {}) {
  const base = { PATH: process.env.PATH ?? "", FETCH_LOG: join(dir, "fetch.log") };
  if (process.env.SystemRoot) base.SystemRoot = process.env.SystemRoot;
  return spawnSync(process.execPath, ["--import", pathToFileURL(join(dir, "stub.mjs")).href, "select-products.js"], {
    cwd: dir, encoding: "utf-8", env: { ...base, ...env }, timeout: 60000,
  });
}

const fetchCount = async (dir) => (existsSync(join(dir, "fetch.log")) ? (await readFile(join(dir, "fetch.log"), "utf-8")).split("\n").filter(Boolean).length : 0);
const listing = async (dir) => (await readdir(dir)).sort();

test("freeze=true: 環境変数がなくても終了コード0で、楽天APIを呼ばず、データファイルを書き換えず、ファイルも作らない", async () => {
  const { dir, data } = await setup({ frozen: true });
  try {
    const filesBefore = await listing(dir);
    const r = runSelect(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /一時停止中/);
    assert.equal(await fetchCount(dir), 0);
    for (const [f, c] of Object.entries(data)) assert.equal(sha(await readFile(join(dir, f), "utf-8")), sha(c), `${f} が変更されました`);
    assert.equal(existsSync(join(dir, "api-errors.log")), false);
    assert.deepEqual((await listing(dir)).filter((f) => f !== "fetch.log"), filesBefore);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freeze=true: 環境変数が設定されていても楽天APIを呼ばず、何も書き込まない", async () => {
  const { dir, data } = await setup({ frozen: true });
  try {
    const r = runSelect(dir, { RAKUTEN_APP_ID: "dummy", RAKUTEN_SECRET: "dummy", RAKUTEN_AFFILIATE_ID: "dummy" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await fetchCount(dir), 0);
    for (const [f, c] of Object.entries(data)) assert.equal(await readFile(join(dir, f), "utf-8"), c);
    assert.equal(existsSync(join(dir, "api-errors.log")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freeze=false: 環境変数がなければ従来どおり非ゼロで終了し、APIは呼ばない(環境変数チェックが生きている)", async () => {
  const { dir, data } = await setup({ frozen: false });
  try {
    const r = runSelect(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RAKUTEN_APP_ID または RAKUTEN_SECRET/);
    assert.equal(await fetchCount(dir), 0);
    for (const [f, c] of Object.entries(data)) assert.equal(await readFile(join(dir, f), "utf-8"), c);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freeze=false: 従来どおり楽天APIを検索し、selected-products.json・posted-history.json・api-errors.logを書く", async () => {
  const { dir } = await setup({ frozen: false });
  try {
    const r = runSelect(dir, { RAKUTEN_APP_ID: "dummy", RAKUTEN_SECRET: "dummy", RAKUTEN_AFFILIATE_ID: "dummy" });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /一時停止中/);
    assert.ok((await fetchCount(dir)) > 0, "楽天APIの検索が呼ばれていません");
    const selected = JSON.parse(await readFile(join(dir, "selected-products.json"), "utf-8"));
    assert.ok(selected.some((i) => i.itemCode === "stubshop:1"), "選定結果にスタブ商品が含まれていません");
    assert.ok(selected.every((i) => i.itemCode !== "sentinel:selected"), "selected-products.jsonが上書きされていません");
    const history = JSON.parse(await readFile(join(dir, "posted-history.json"), "utf-8"));
    assert.ok(history.includes("sentinel:history") && history.includes("stubshop:1"), "履歴に追記されていません");
    assert.equal(existsSync(join(dir, "api-errors.log")), true);
    assert.equal(await readFile(join(dir, "articles-data.json"), "utf-8"), JSON.stringify([{ itemCode: "sentinel:article" }], null, 2));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("select-products.js: 凍結の判定は環境変数のチェックとAPI呼び出しコードよりも前にある(構造の確認)", async () => {
  const src = await readFile(join(PROJECT_ROOT, "select-products.js"), "utf-8");
  const exitAt = src.indexOf("process.exit(0);");
  assert.ok(exitAt > 0);
  assert.ok(src.indexOf("ARTICLE_GROWTH_FROZEN") < src.indexOf("process.env.RAKUTEN_APP_ID"));
  assert.ok(exitAt < src.indexOf("process.env.RAKUTEN_APP_ID"));
  assert.ok(exitAt < src.indexOf("fetch("));
  assert.ok(exitAt < src.indexOf("writeFile("));
});

// ---- freeze状態の日次処理: generate-site.js は記事を増やさない ----

function makeItem(i, extra = {}) {
  return {
    itemCode: `test:item${i}`, itemName: `テスト商品${i}`, itemPrice: 1000 + i,
    itemUrl: `https://item.rakuten.co.jp/testshop/item${i}/`, catchcopy: "", reviewAverage: 4.5, reviewCount: 100,
    matchedKeyword: "テストジャンル", ...extra,
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

async function setupSite({ existing, selected }) {
  const dir = await mkdtemp(join(tmpdir(), "freeze-generate-site-test-"));
  await cp(join(PROJECT_ROOT, "generate-site.js"), join(dir, "generate-site.js"));
  await cp(join(PROJECT_ROOT, "lib"), join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "selected-products.json"), JSON.stringify(selected, null, 2), "utf-8");
  await writeFile(join(dir, "articles-data.json"), JSON.stringify(existing, null, 2), "utf-8");
  await mkdir(join(dir, "docs", "rankings"), { recursive: true });
  await mkdir(join(dir, "keyword-research"), { recursive: true });
  await writeFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), TRIAL_PAGE_HTML, "utf-8");
  await writeFile(
    join(dir, "keyword-research", "search-trial-pages.json"),
    JSON.stringify({ pages: [{ slug: "senior-dog-pork", path: "rankings/senior-dog-pork.html", title: "テスト試験公開ページ", status: "search_trial", startDate: "2026-09-10", reviewDate: "2026-10-10", pageType: "search_trial_ranking", sitemapEnabled: true, internalLinkEnabled: true, searchIndexEnabled: true }] }),
    "utf-8"
  );
  return dir;
}

const runGenerate = (dir) => spawnSync(process.execPath, ["generate-site.js"], { cwd: dir, encoding: "utf-8" });
const articleFiles = async (dir) => (await readdir(join(dir, "docs", "articles"))).filter((f) => f.endsWith(".html")).sort();

test("freeze状態: 登録済み商品だけの selected-products.json が残っていても、generate-site.js実行後の記事数は増えない", async () => {
  const existing = [1, 2, 3].map((i) => makeItem(i, { snapshotDate: "2026-08-27" }));
  const dir = await setupSite({ existing, selected: existing });
  try {
    assert.equal(runGenerate(dir).status, 0);
    const first = await articleFiles(dir);
    assert.equal(first.length, 3);
    const dataAfter = await readFile(join(dir, "articles-data.json"), "utf-8");
    assert.equal(dataAfter, JSON.stringify(existing, null, 2));
    // 2回目(翌日以降の日次実行を模す): 記事数・データ・生成物が変わらない
    const sitemap1 = await readFile(join(dir, "docs", "sitemap.xml"), "utf-8");
    assert.equal(runGenerate(dir).status, 0);
    assert.deepEqual(await articleFiles(dir), first);
    assert.equal(await readFile(join(dir, "articles-data.json"), "utf-8"), dataAfter);
    assert.equal(await readFile(join(dir, "docs", "sitemap.xml"), "utf-8"), sitemap1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("freeze状態: 検索公開試験ページは generate-site.js 実行後も変更されない", async () => {
  const existing = [1, 2, 3].map((i) => makeItem(i, { snapshotDate: "2026-08-27" }));
  const dir = await setupSite({ existing, selected: existing });
  try {
    assert.equal(runGenerate(dir).status, 0);
    assert.equal(await readFile(join(dir, "docs", "rankings", "senior-dog-pork.html"), "utf-8"), TRIAL_PAGE_HTML);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
