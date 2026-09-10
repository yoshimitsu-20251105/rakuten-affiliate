// 【2026-09-10 検索公開試験対応】lib/search-trial-config.js の検証テスト。
// 「設定ファイル自体が存在しない場合だけはfail open(試験ページなし)、それ以外の
// 不正(JSON構文エラー・必須項目欠落・slug重複・参照先HTML不在・日付形式不正・
// reviewDateがstartDateより前・未知のstatus)はすべて例外を投げる」ことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSearchTrialConfig } from "../../lib/search-trial-config.js";

async function makeTempDirs() {
  const root = await mkdtemp(join(tmpdir(), "search-trial-config-test-"));
  const docsDir = join(root, "docs") + "/";
  const rankingsDir = join(docsDir, "rankings");
  await mkdir(rankingsDir, { recursive: true });
  return { root, docsDir };
}

function validPage(overrides = {}) {
  return {
    slug: "senior-dog-pork",
    path: "rankings/senior-dog-pork.html",
    title: "テストページ",
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

async function writeConfig(root, data) {
  const configPath = join(root, "search-trial-pages.json");
  await writeFile(configPath, JSON.stringify(data, null, 2), "utf-8");
  return configPath;
}

test("search-trial-config: 設定ファイルが存在しない場合はfail open(pages:[]、例外を投げない)", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    const configPath = join(root, "does-not-exist.json");
    const result = await loadSearchTrialConfig(configPath, docsDir);
    assert.deepEqual(result, { pages: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: JSON構文が不正な場合は非ゼロ終了相当(例外)になる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    const configPath = join(root, "search-trial-pages.json");
    await writeFile(configPath, "{ this is not json", "utf-8");
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: pagesが配列でない場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    const configPath = await writeConfig(root, { pages: "not-an-array" });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: 必須項目(例: title)が欠落している場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const page = validPage();
    delete page.title;
    const configPath = await writeConfig(root, { pages: [page] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /title/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: boolean項目(例: sitemapEnabled)が真偽値でない場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage({ sitemapEnabled: "true" })] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /sitemapEnabled/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: slugが重複している場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, {
      pages: [validPage(), validPage({ path: "rankings/senior-dog-pork-2.html" })],
    });
    await writeFile(join(docsDir, "rankings", "senior-dog-pork-2.html"), "<html></html>", "utf-8");
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /重複/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: 参照先のHTMLファイルが存在しない場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    // わざとdocs/rankings/senior-dog-pork.htmlを作成しない
    const configPath = await writeConfig(root, { pages: [validPage()] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /存在しません/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: startDateの形式が不正(YYYY-MM-DDでない)場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage({ startDate: "2026/09/10" })] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /startDate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: reviewDateの形式が不正な場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage({ reviewDate: "not-a-date" })] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /reviewDate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: reviewDateがstartDateより前の場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage({ startDate: "2026-09-10", reviewDate: "2026-09-01" })] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /reviewDate/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: 未知のstatusの場合は例外を投げる", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage({ status: "unknown_status" })] });
    await assert.rejects(() => loadSearchTrialConfig(configPath, docsDir), /status/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: 正常な設定は検証済みのpages配列をそのまま返す", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, { pages: [validPage()] });
    const result = await loadSearchTrialConfig(configPath, docsDir);
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].slug, "senior-dog-pork");
    assert.equal(result.pages[0].sitemapEnabled, true);
    assert.equal(result.pages[0].internalLinkEnabled, true);
    assert.equal(result.pages[0].searchIndexEnabled, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("search-trial-config: sitemapEnabled/internalLinkEnabled/searchIndexEnabledを個別にfalseにできる(試験の個別停止)", async () => {
  const { root, docsDir } = await makeTempDirs();
  try {
    await writeFile(join(docsDir, "rankings", "senior-dog-pork.html"), "<html></html>", "utf-8");
    const configPath = await writeConfig(root, {
      pages: [validPage({ sitemapEnabled: false, internalLinkEnabled: false, searchIndexEnabled: false })],
    });
    const result = await loadSearchTrialConfig(configPath, docsDir);
    assert.equal(result.pages[0].sitemapEnabled, false);
    assert.equal(result.pages[0].internalLinkEnabled, false);
    assert.equal(result.pages[0].searchIndexEnabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
