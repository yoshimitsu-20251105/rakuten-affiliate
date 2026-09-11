// 【2026-09-11監査対応】keywords:analytics:search-trial-report CLIの統合テスト。
//
// 【重要・外部API呼び出し0件を構造的に保証する設計】
// このCLIは --live フラグ・SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED=true・
// GA_SEARCH_CONSOLE_KEY_FILE(実在する有効なサービスアカウントJSON)の3条件すべてを
// 満たさない限り、Google APIクライアントを一切生成しない(既定パスへの
// 自動fallbackも行わない)。このテストファイルは意図的に:
//   - ほとんどのテストで --live を指定しない(ゲートで即座に拒否されることを確認)
//   - date/config検証を確認するテストでは --live 一式を渡すが、鍵ファイルは
//     完全にfakeな内容(実サービスアカウントではない)にし、かつbuild層が
//     fetcher呼び出しより前に検証で例外を投げることを利用して、実ネットワークへは
//     到達しない設計にしている(build層の検証順序はsearch-trial-report-build.jsで
//     日付→設定JSON→期間の順に検証してからfetchersを呼ぶことを確認済み)
//   - 「ライブ条件を満たした正常系」は実APIではなくmockで確認する方針のため
//     (search-trial-fetchers-resolver.test.js参照)、このファイルでは検証しない
//
// 実docs/・実search-trial-pages.json・実output/は一切使わず、--docs-dir・
// --search-trial-config・--output-dirで隔離した一時ディレクトリだけを使う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const CLI = fileURLToPath(new URL("../cli/search-trial-report.js", import.meta.url));
const REAL_REPO_CREDENTIALS_PATH = fileURLToPath(new URL("../../credentials/ga-search-console-key.json", import.meta.url));

const DOG_SLUG = "senior-dog-pork";
const CAT_SLUG = "grain-free-cat-food";

function runCli(args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of Object.keys(envOverrides)) {
    if (envOverrides[key] === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [CLI, ...args], { cwd: PROJECT_ROOT, encoding: "utf-8", env });
}

async function setupFixture() {
  const root = await mkdtemp(join(tmpdir(), "search-trial-report-cli-test-"));
  const docsDir = join(root, "docs") + "/";
  const outputDir = join(root, "output") + "/";
  await mkdir(join(docsDir, "rankings"), { recursive: true });
  await writeFile(join(docsDir, "rankings", `${DOG_SLUG}.html`), "<html><body>dog fixture</body></html>", "utf-8");
  await writeFile(join(docsDir, "rankings", `${CAT_SLUG}.html`), "<html><body>cat fixture</body></html>", "utf-8");

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

  // ライブゲートのfile-exists/JSON形式チェックだけを通過させるための、
  // 完全にfakeな(実サービスアカウントではない)鍵ファイル。
  const fakeKeyFilePath = join(root, "fake-key.json");
  await writeFile(fakeKeyFilePath, JSON.stringify({ type: "service_account", client_email: "fake-test@example-not-real.iam.gserviceaccount.com", private_key: "FAKE" }), "utf-8");

  return { root, docsDir, outputDir, configPath, fakeKeyFilePath };
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true });
}

test("CLI: 必須引数(--from/--to/--run-id)が無い場合は非ゼロ終了する", () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--from.*--to.*--run-id/);
});

test("CLI: run-idが不正(記号を含む)な場合は非ゼロ終了する(ライブゲートより前に拒否)", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "bad id!", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(outputDir), false);
  } finally {
    await cleanup(root);
  }
});

// =====================================================================
// 【ライブ実行ゲート】--live・SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED・
// GA_SEARCH_CONSOLE_KEY_FILEの3条件すべてを満たさない限り、Google APIクライアントは
// 生成されない(=外部API呼び出しは常に0件)。
// =====================================================================

test("CLI: 実credentials/ga-search-console-key.jsonが実在しても、--live未指定ではAPIクライアント生成0件で拒否する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    // 開発機に実際の認証ファイルが存在する場合を想定し、あえてその実パスを
    // GA_SEARCH_CONSOLE_KEY_FILEに設定したうえで、--liveなしでは拒否されることを確認する
    // (このテストは実ファイルの中身を一切読まない)。
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-no-live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: REAL_REPO_CREDENTIALS_PATH }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--live/);
    assert.equal(existsSync(join(outputDir, "run-no-live")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: --liveだけではAPI呼び出し0件で拒否する(feature flag未設定)", async () => {
  const { root, docsDir, outputDir, configPath, fakeKeyFilePath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-live-only", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: undefined, GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED/);
  } finally {
    await cleanup(root);
  }
});

test("CLI: feature flagだけではAPI呼び出し0件で拒否する(--live未指定)", async () => {
  const { root, docsDir, outputDir, configPath, fakeKeyFilePath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-flag-only", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--live/);
  } finally {
    await cleanup(root);
  }
});

test("CLI: --liveとfeature flagの両方があっても、認証パス環境変数が無ければAPI呼び出し0件で拒否する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-no-keyfile", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GA_SEARCH_CONSOLE_KEY_FILE/);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 認証パスが存在しないファイルを指す場合はAPI呼び出し0件で拒否する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-bad-keyfile", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: "/definitely/does/not/exist/key.json" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /見つかりません/);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 認証ファイルの形式が不正な場合はAPI呼び出し0件で拒否する", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const badKeyFile = join(root, "bad-key.json");
    await writeFile(badKeyFile, "{ not valid json", "utf-8");
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-malformed-keyfile", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: badKeyFile }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /形式が不正/);
  } finally {
    await cleanup(root);
  }
});

// =====================================================================
// ゲートを通過した後のbuild層検証(日付・期間・設定JSON)。build層はfetchersを
// 呼び出すより前にこれらを検証して例外を投げるため、fakeな鍵ファイルで
// ゲートを通過させても実ネットワークへは到達しない(search-trial-report-build.js
// の検証順序: 日付形式 → 設定JSON → 期間 → (ここでfetchersループ) )。
// =====================================================================

test("CLI: 日付形式が不正な場合は非ゼロ終了し、出力を残さない(ライブゲート通過後もfetcher呼び出し前に拒否)", async () => {
  const { root, docsDir, outputDir, configPath, fakeKeyFilePath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026/09/10", "--to", "2026-09-16", "--run-id", "run-bad-date", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-bad-date")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 対象期間が試験期間外の場合は非ゼロ終了する", async () => {
  const { root, docsDir, outputDir, configPath, fakeKeyFilePath } = await setupFixture();
  try {
    const result = runCli(
      ["--from", "2026-08-01", "--to", "2026-08-07", "--run-id", "run-out-of-period", "--live", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-out-of-period")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 設定JSONが不正な場合は非ゼロ終了し、出力を残さない", async () => {
  const { root, docsDir, outputDir, fakeKeyFilePath } = await setupFixture();
  try {
    const badConfigPath = join(root, "bad.json");
    await writeFile(badConfigPath, "{ not json", "utf-8");
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-bad-config", "--live", "--docs-dir", docsDir, "--search-trial-config", badConfigPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-bad-config")), false);
  } finally {
    await cleanup(root);
  }
});

// =====================================================================
// 同一run-id・前回レポート不存在の拒否は、ライブゲートより前の軽量チェックとして
// 行われるため、--liveを一切指定せずに検証できる(実ネットワークへは到達しない)。
// =====================================================================

test("CLI: 同一run-idの出力が既に存在する場合は上書きせず非ゼロ終了する(ライブゲートより前に拒否、API呼び出し0件)", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    // 「既に出力が存在する」状態を、実行済みレポートを模したディレクトリで再現する
    // (実際にCLIを成功させて作る必要はない=実ネットワークに触れない)。
    await mkdir(join(outputDir, "run-dup"), { recursive: true });
    await writeFile(join(outputDir, "run-dup", "report.json"), JSON.stringify({ runId: "run-dup", pages: [] }), "utf-8");

    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-13", "--run-id", "run-dup", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /既に存在/);

    const after = await readFile(join(outputDir, "run-dup", "report.json"), "utf-8");
    assert.equal(after, JSON.stringify({ runId: "run-dup", pages: [] }), "既存の出力が上書きされていないこと");
  } finally {
    await cleanup(root);
  }
});

test("CLI: --previous-run-idで指定したレポートが存在しない場合は非ゼロ終了する(ライブゲートより前に拒否)", async () => {
  const { root, docsDir, outputDir, configPath } = await setupFixture();
  try {
    const result = runCli(["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-no-prev", "--previous-run-id", "does-not-exist", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir]);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(outputDir, "run-no-prev")), false);
  } finally {
    await cleanup(root);
  }
});

test("CLI: 秘密情報(認証ファイルのパス・サービスアカウント等)を標準出力・標準エラーへ出力しない", async () => {
  const { root, docsDir, outputDir, configPath, fakeKeyFilePath } = await setupFixture();
  try {
    // --liveを指定せず(ゲートで即座に拒否される、実ネットワークには到達しない)、
    // GA_SEARCH_CONSOLE_KEY_FILEに値を設定した状態でも、その値自体がログへ
    // 出力されないことを確認する。
    const result = runCli(
      ["--from", "2026-09-10", "--to", "2026-09-16", "--run-id", "run-secret-check", "--docs-dir", docsDir, "--search-trial-config", configPath, "--output-dir", outputDir],
      { SEARCH_TRIAL_ANALYTICS_LIVE_ENABLED: "true", GA_SEARCH_CONSOLE_KEY_FILE: fakeKeyFilePath }
    );
    assert.notEqual(result.status, 0);
    const combined = result.stdout + result.stderr;
    assert.doesNotMatch(combined, /fake-key\.json/);
    assert.doesNotMatch(combined, /iam\.gserviceaccount\.com/);
  } finally {
    await cleanup(root);
  }
});
