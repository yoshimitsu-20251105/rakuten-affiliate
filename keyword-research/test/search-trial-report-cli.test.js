// 【2026-09-17 Phase 3C対応】keywords:analytics:search-trial-report CLIの統合テスト。
// 実docs/・実search-trial-pages.json・実output/は一切使わず、--docs-dir・
// --search-trial-config・--output-dirで隔離した一時ディレクトリだけを使う。
// このテスト環境にはcredentials/が存在しないため、CLIが実際に呼び出す
// search-trial-analytics-clients.jsの実装はすべて「未設定」を経由し、外部APIには
// 一切到達しない(0件)。公開サイトファイル(docs/)はこのCLIの対象外であり、
// テストでも一切書き込まれないことを確認する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const CLI = fileURLToPath(new URL("../cli/search-trial-report.js", import.meta.url));

const DOG_SLUG = "senior-dog-pork";
const CAT_SLUG = "grain-free-cat-food";

// 【重要】開発機に実在するcredentials/ga-search-console-key.jsonへ到達しないよう、
// 存在しないパスを明示的に指定する(このリポジトリの開発機で実際にこの対策が
// 必要だったことが判明している。指定しないテストは開発機によっては実際の
// GA4/Search Console APIへ到達してしまう)。
function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    env: { ...process.env, GA_SEARCH_CONSOLE_KEY_FILE: "/definitely/does/not/exist/search-trial-report-cli-test.json" },
  });
}

async function fileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath, "utf-8"), "utf-8").digest("hex");
}

async function setupFixture() {
  const root = await mkdtemp(join(tmpdir(), "search-trial-report-cli-test-"));
  const docsDir = join(root, "docs") + "/";
  const outputDir = join(root, "output") + "/";
  await mkdir(join(docsDir, "rankings"), { recursive: true });
  const dogHtml = "<html><body>dog fixture, unchanged marker A</body></html>";
  const catHtml = "<html><body>cat fixture, unchanged marker B</body></html>";
  await writeFile(join(docsDir, "rankings", `${DOG_SLUG}.html`), dogHtml, "utf-8");
  await writeFile(join(docsDir, "rankings", `${CAT_SLUG}.html`), catHtml, "utf-8");

  const configPath = join(root, "search-trial-pages.json");
  await writeFile(
    configPath,
    JSON.stringify({
      pages: [
        { slug: DOG_SLUG, path: `rankings/${DOG_SLUG}.html`, title: "犬ページ", status: "search_trial", startDate: "2026-09-10", reviewDate: "2026-10-10", pageType: "search_trial_ranking", sitemapEnabled: true, internalLinkEnabled: true, searchIndexEnabled: true },
        { slug: CAT_SLUG, path: `rankings/${CAT_SLUG}.html`, title: "猫ページ", status: "search_trial", startDate: "2026-09-10", reviewDate: "2026-10-10", pageType: "search_trial_ranking", sitemapEnabled: true, internalLinkEnabled: true, searchIndexEnabled: true },
      ],
    }),
    "utf-8"
  );

  return { root, docsDir, outputDir, configPath };
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

test("CLI: 必須引数(--from/--to/--run-id)が無い場合は非ゼロ終了する", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--from.*--to.*--run-id/);
});

test("CLI: run-idが不正(記号を含む)な場合は非ゼロ終了する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "bad id!", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(outputDir), false, "不正なrun-idの場合は出力先自体を作成しないこと");
  } finally {
    await cleanup(root);
  }
});

test("CLI: 日付形式が不正な場合は非ゼロ終了し、出力を残さない", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026/09/10", "--to", "2026-09-16", "--run-id", "run-bad-date", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-bad-date")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 対象期間が試験期間外の場合は非ゼロ終了する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-08-01", "--to", "2026-08-07", "--run-id", "run-out-of-period", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-out-of-period")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 正常な実行はreport.md/report.json/run-metadata.jsonを生成し、docs/配下は一切変更しない", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const beforeDogHash = await fileHash(join(docsDir, "rankings", `${DOG_SLUG}.html`));
    const beforeCatHash = await fileHash(join(docsDir, "rankings", `${CAT_SLUG}.html`));

    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-ok-1", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.equal(result.status, 0, result.stderr);

    const outDir = join(outputDir, "run-ok-1");
    assert.ok(existsSync(join(outDir, "report.md")));
    assert.ok(existsSync(join(outDir, "report.json")));
    assert.ok(existsSync(join(outDir, "run-metadata.json")));

    const report = JSON.parse(await readFile(join(outDir, "report.json"), "utf-8"));
    assert.equal(report.pages.length, 2);
    // このテスト環境にcredentials/は存在しないため、GA4/Search Consoleは
    // 未設定として扱われ、外部APIには一切到達しない。
    assert.equal(report.pages[0].searchConsole.status, "NOT_AVAILABLE");
    assert.equal(report.pages[0].ga4.status, "NOT_AVAILABLE");
    assert.equal(report.pages[0].rakuten.status, "NOT_CONNECTED");

    const afterDogHash = await fileHash(join(docsDir, "rankings", `${DOG_SLUG}.html`));
    const afterCatHash = await fileHash(join(docsDir, "rankings", `${CAT_SLUG}.html`));
    assert.equal(beforeDogHash, afterDogHash, "犬ページのfixtureが実行前後で不変であること");
    assert.equal(beforeCatHash, afterCatHash, "猫ページのfixtureが実行前後で不変であること");
  } finally {
    await cleanup(root);
  }
});

test("CLI: 同一run-idで再実行すると上書きせず非ゼロ終了する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const first = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-dup", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.equal(first.status, 0, first.stderr);
    const before = await readFile(join(outputDir, "run-dup", "report.json"), "utf-8");

    const second = runCli(["--from", "2026-09-10", "--to", "2026-09-13", "--run-id", "run-dup", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(second.status, 0);

    const after = await readFile(join(outputDir, "run-dup", "report.json"), "utf-8");
    assert.equal(before, after, "既存の出力が上書きされていないこと");
  } finally {
    await cleanup(root);
  }
});

test("CLI: --previous-run-idで指定したレポートが存在しない場合は非ゼロ終了する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-no-prev", "--previous-run-id", "does-not-exist", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-no-prev")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: --previous-run-idを指定すると前回レポートとの差分をreport.jsonへ含める", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const first = runCli(["--from", "2026-09-10", "--to", "2026-09-13", "--run-id", "run-prev", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.equal(first.status, 0, first.stderr);

    const second = runCli(["--from", "2026-09-14", "--to", "2026-09-16", "--run-id", "run-current", "--previous-run-id", "run-prev", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.equal(second.status, 0, second.stderr);

    const report = JSON.parse(await readFile(join(outputDir, "run-current", "report.json"), "utf-8"));
    assert.equal(report.diffFromPrevious.previousRunId, "run-prev");
  } finally {
    await cleanup(root);
  }
});

test("CLI: 設定JSONが不正な場合は非ゼロ終了し、出力を残さない", async () => {
  const { root, docsDir, outputDir } = await setupFixture();
  try {
    const badConfigPath = join(root, "bad.json");
    await writeFile(badConfigPath, "{ not json", "utf-8");
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-bad-config", "--docs-dir", docsDir, "--search-trial-config", badConfigPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-bad-config")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 秘密情報(認証ファイルの絶対パス等)を標準出力・標準エラーへ出力しない", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-secret-check", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.equal(result.status, 0, result.stderr);
    const combined = result.stdout + result.stderr;
    assert.doesNotMatch(combined, /credentials[\\/]ga-search-console-key\.json/);
    assert.doesNotMatch(combined, /iam\.gserviceaccount\.com/);
  } finally {
    await cleanup(root);
  }
});
