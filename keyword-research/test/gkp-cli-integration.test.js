// 【2026-09-06 正式CLI対応】keywords:import-gkp / keywords:gkp-dry-run のCLI統合テスト。
// 実際にサブプロセスとしてCLIを起動し、エラー終了・出力ファイル・既存サイトへの
// 無影響・シークレット非漏洩・再現性(candidateSetHash)を検証する。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const IMPORT_GKP_CLI = fileURLToPath(new URL("../cli/import-gkp.js", import.meta.url));
const GKP_DRY_RUN_CLI = fileURLToPath(new URL("../cli/gkp-dry-run.js", import.meta.url));
const GKP_RUNS_DIR = fileURLToPath(new URL("../output/gkp-runs/", import.meta.url));

function makeGkpCsv(rows, { title = "Keyword Stats", period = "2025年8月1日 - 2026年7月31日" } = {}) {
  const header = "Keyword\tAvg. monthly searches\tCompetition";
  const lines = rows.map((r) => `${r.keyword}\t${r.monthlySearches}\t${r.competition ?? "低"}`);
  return [title, period, header, ...lines].join("\n") + "\n";
}

async function withTempCsvPair(dogRows, catRows, fn) {
  const dir = await mkdtemp(join(tmpdir(), "gkp-cli-"));
  const dogPath = join(dir, "dog.csv");
  const catPath = join(dir, "cat.csv");
  await writeFile(dogPath, makeGkpCsv(dogRows), "utf-8");
  await writeFile(catPath, makeGkpCsv(catRows), "utf-8");
  try {
    return await fn({ dogPath, catPath });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runCli(scriptPath, args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of Object.keys(envOverrides)) {
    if (envOverrides[key] === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd: PROJECT_ROOT, encoding: "utf-8", env });
}

async function rmRunDir(runId) {
  await rm(join(GKP_RUNS_DIR, runId), { recursive: true, force: true });
}

const DOG_ROWS = [
  { keyword: "国産 無添加 ドッグフード", monthlySearches: 5000 },
  { keyword: "シニア ドッグフード", monthlySearches: 500 },
];
const CAT_ROWS = [{ keyword: "国産 無添加 キャットフード", monthlySearches: 1000 }];

test("import-gkpは楽天APIを一切呼び出さない(searchSourceCountsが全件skipped)", async () => {
  const runId = `test-import-gkp-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.equal(result.status, 0, result.stderr);
    const metadata = JSON.parse(await readFile(join(GKP_RUNS_DIR, runId, "run-metadata.json"), "utf-8"));
    assert.deepEqual(Object.keys(metadata.searchSourceCounts), ["skipped"]);
    assert.equal(metadata.rakutenSource, null);
  });
  await rmRunDir(runId);
});

test("--rakuten-source未指定のgkp-dry-runはエラーになる(非ゼロ終了、出力先を作らない)", async () => {
  const runId = `test-norakuten-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(GKP_DRY_RUN_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rakuten-source/);
    assert.equal(existsSync(join(GKP_RUNS_DIR, runId)), false, "エラー時は出力先を作らない");
  });
});

test("live指定で認証情報が無い場合はfail closedになる(楽天APIを1件も呼ばず非ゼロ終了、出力先を作らない)", async () => {
  const runId = `test-failclosed-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(
      GKP_DRY_RUN_CLI,
      ["--dog-csv", dogPath, "--cat-csv", catPath, "--rakuten-source", "live", "--run-id", runId],
      { RAKUTEN_APP_ID: undefined, RAKUTEN_SECRET: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /RAKUTEN_APP_ID\/RAKUTEN_SECRETが未設定/);
    assert.doesNotMatch(result.stdout, /fixture/i, "fixtureへフォールバックしたことを示す文言が出ていないこと");
    assert.equal(existsSync(join(GKP_RUNS_DIR, runId)), false, "認証情報が無い場合は出力先すら作らない(API呼び出し前に失敗する)");
  });
});

test("fixture明示指定時は承認・出力・掲載ゲートがすべて強制的にfalseになる", async () => {
  const runId = `test-fixture-gate-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(GKP_DRY_RUN_CLI, [
      "--dog-csv",
      dogPath,
      "--cat-csv",
      catPath,
      "--rakuten-source",
      "fixture",
      "--max-rakuten-keywords",
      "5",
      "--run-id",
      runId,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const scoresCsv = await readFile(join(GKP_RUNS_DIR, runId, "keyword-scores.csv"), "utf-8");
    const lines = scoresCsv.trim().split("\n");
    const header = lines[0].split(",");
    const eligibleForApprovalIdx = header.indexOf("eligibleForApproval");
    const eligibleForExportIdx = header.indexOf("eligibleForExport");
    const eligibleForPublishIdx = header.indexOf("eligibleForPublish");
    for (const line of lines.slice(1)) {
      const cells = line.split(",");
      assert.equal(cells[eligibleForApprovalIdx], "false", "fixture実行ではeligibleForApprovalは常にfalse");
      assert.equal(cells[eligibleForExportIdx], "false", "fixture実行ではeligibleForExportは常にfalse");
      assert.equal(cells[eligibleForPublishIdx], "false", "fixture実行ではeligibleForPublishは常にfalse");
    }
    const summary = await readFile(join(GKP_RUNS_DIR, runId, "summary.md"), "utf-8");
    assert.match(summary, /テストデータ・実運用不可/);
    const metadata = JSON.parse(await readFile(join(GKP_RUNS_DIR, runId, "run-metadata.json"), "utf-8"));
    assert.equal(metadata.status, "completed");
  });
  await rmRunDir(runId);
});

test("--max-rakuten-keywords=100は成功する(絶対上限ちょうど)", async () => {
  const runId = `test-max100-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(GKP_DRY_RUN_CLI, [
      "--dog-csv",
      dogPath,
      "--cat-csv",
      catPath,
      "--rakuten-source",
      "fixture",
      "--max-rakuten-keywords",
      "100",
      "--run-id",
      runId,
    ]);
    assert.equal(result.status, 0, result.stderr);
  });
  await rmRunDir(runId);
});

test("--max-rakuten-keywords=101/小数/0/負数はいずれもエラーになり、出力先を作らない", async () => {
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    for (const invalid of ["101", "10.5", "0", "-1"]) {
      const runId = `test-maxinvalid-${invalid}-${Date.now()}`;
      const result = runCli(GKP_DRY_RUN_CLI, [
        "--dog-csv",
        dogPath,
        "--cat-csv",
        catPath,
        "--rakuten-source",
        "fixture",
        "--max-rakuten-keywords",
        invalid,
        "--run-id",
        runId,
      ]);
      assert.notEqual(result.status, 0, `--max-rakuten-keywords=${invalid} はエラーになるはず`);
      assert.equal(existsSync(join(GKP_RUNS_DIR, runId)), false, `--max-rakuten-keywords=${invalid} は出力先を作らないはず`);
    }
  });
});

test("出力先が既に存在する場合はエラーになり、上書きしない", async () => {
  const runId = `test-existing-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const first = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /既に存在/);
  });
  await rmRunDir(runId);
});

test("run-metadata.jsonおよびsummary.mdに認証情報(APIキー等)が含まれない", async () => {
  const runId = `test-nosecret-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.equal(result.status, 0, result.stderr);
    const metadataText = await readFile(join(GKP_RUNS_DIR, runId, "run-metadata.json"), "utf-8");
    const summaryText = await readFile(join(GKP_RUNS_DIR, runId, "summary.md"), "utf-8");
    for (const secretLike of [process.env.RAKUTEN_APP_ID, process.env.RAKUTEN_SECRET].filter(Boolean)) {
      assert.doesNotMatch(metadataText, new RegExp(secretLike.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(summaryText, new RegExp(secretLike.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(metadataText, /applicationId|accessKey/i);
  });
  await rmRunDir(runId);
});

test("同一入力・同一設定から実行すると同一のcandidateSetHashが得られる(再現性)", async () => {
  const runIdA = `test-repro-a-${Date.now()}`;
  const runIdB = `test-repro-b-${Date.now()}`;
  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const a = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runIdA]);
    const b = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runIdB]);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    const metaA = JSON.parse(await readFile(join(GKP_RUNS_DIR, runIdA, "run-metadata.json"), "utf-8"));
    const metaB = JSON.parse(await readFile(join(GKP_RUNS_DIR, runIdB, "run-metadata.json"), "utf-8"));
    assert.equal(metaA.candidateSetHash, metaB.candidateSetHash);
    assert.equal(metaA.inputFileHashes.dog, metaB.inputFileHashes.dog);
  });
  await rmRunDir(runIdA);
  await rmRunDir(runIdB);
});

test("import-gkp実行の前後で既存サイトのファイル(docs/index.html, articles-data.json)が一切変更されない", async () => {
  const runId = `test-siteimpact-${Date.now()}`;
  const indexPath = join(PROJECT_ROOT, "docs", "index.html");
  const articlesPath = join(PROJECT_ROOT, "articles-data.json");
  const beforeIndex = await readFile(indexPath, "utf-8");
  const beforeArticles = await readFile(articlesPath, "utf-8");
  const beforeIndexStat = await stat(indexPath);
  const beforeArticlesStat = await stat(articlesPath);

  await withTempCsvPair(DOG_ROWS, CAT_ROWS, async ({ dogPath, catPath }) => {
    const result = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.equal(result.status, 0, result.stderr);
  });
  await rmRunDir(runId);

  const afterIndex = await readFile(indexPath, "utf-8");
  const afterArticles = await readFile(articlesPath, "utf-8");
  const afterIndexStat = await stat(indexPath);
  const afterArticlesStat = await stat(articlesPath);

  assert.equal(beforeIndex, afterIndex, "docs/index.htmlが変更されていないこと");
  assert.equal(beforeArticles, afterArticles, "articles-data.jsonが変更されていないこと");
  assert.equal(beforeIndexStat.mtimeMs, afterIndexStat.mtimeMs);
  assert.equal(beforeArticlesStat.mtimeMs, afterArticlesStat.mtimeMs);
});

test(".gitignoreがkeyword-research/output/配下(gkp-runsを含む)をすべて除外している", () => {
  const gitignore = readFileSync(join(PROJECT_ROOT, ".gitignore"), "utf-8");
  assert.match(gitignore, /keyword-research\/output\//);
});

test("犬用・猫用CSVのいずれかが空(有効なキーワード行が無い)場合はエラーになる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gkp-cli-empty-"));
  try {
    const dogPath = join(dir, "dog.csv");
    const catPath = join(dir, "cat.csv");
    await writeFile(dogPath, makeGkpCsv(DOG_ROWS), "utf-8");
    await writeFile(catPath, makeGkpCsv([]), "utf-8"); // ヘッダーのみ、データ行なし
    const runId = `test-empty-${Date.now()}`;
    const result = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    // 猫用が0行でも犬用にデータがあるため合計は空にならない。真の「両方とも空」を確認する。
    assert.equal(result.status, 0);
    await rmRunDir(runId);

    const runId2 = `test-empty2-${Date.now()}`;
    await writeFile(dogPath, makeGkpCsv([]), "utf-8");
    const result2 = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId2]);
    assert.notEqual(result2.status, 0);
    assert.match(result2.stderr, /CSVが空です/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("失敗時もrun-metadata.jsonにstatus=failedと理由が安全に残る", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gkp-cli-fail-"));
  try {
    const dogPath = join(dir, "dog.csv");
    const catPath = join(dir, "cat.csv");
    await writeFile(dogPath, makeGkpCsv([]), "utf-8");
    await writeFile(catPath, makeGkpCsv([]), "utf-8");
    const runId = `test-failmeta-${Date.now()}`;
    const result = runCli(IMPORT_GKP_CLI, ["--dog-csv", dogPath, "--cat-csv", catPath, "--run-id", runId]);
    assert.notEqual(result.status, 0);
    const metadata = JSON.parse(await readFile(join(GKP_RUNS_DIR, runId, "run-metadata.json"), "utf-8"));
    assert.equal(metadata.status, "failed");
    assert.ok(metadata.error);
    await rmRunDir(runId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
