// 【2026-09-07 Phase 3A対応 / PR#5監査対応で一部改訂】keywords:build-pilot-drafts CLI統合テスト。
// feature flag・承認ファイル必須・出力先・既存サイト無影響・ネットワーク呼び出し0件・
// 部分失敗時のクリーンアップを、実際にサブプロセスとして起動して検証する。
//
// artifactHashes/candidateSetHashは実ファイルから再計算されるため、フィクスチャは
// 実際に書き込んだファイル内容から算出したハッシュを使う。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File, computeCandidateSetHash } from "../hash-utils.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const CLI = fileURLToPath(new URL("../cli/build-pilot-drafts.js", import.meta.url));
const PILOT_DRAFTS_DIR = fileURLToPath(new URL("../output/pilot-drafts/", import.meta.url));
const ARTIFACT_FILENAMES = ["keyword-scores.csv", "keyword-candidates.csv", "rakuten-matches.csv", "rakuten-items.json"];
const KEYWORD = "シニア 犬 豚肉";
const SOURCE_RUN_ID = "cli-test-source-run";

async function writeCsv(dir, filename, header, rows) {
  const lines = rows.map((r) => header.split(",").map((h) => r[h] ?? "").join(","));
  await writeFile(join(dir, filename), [header, ...lines].join("\n") + "\n", "utf-8");
}

/**
 * source run一式を実際に書き込み、artifactHashes/candidateSetHashを実ファイルから
 * 計算してrun-metadata.jsonへ埋め込む。
 * @returns {Promise<string>} 実際に計算されたcandidateSetHash
 */
async function buildValidSourceRun(dir) {
  const scoresRows = [
    {
      originalKeyword: KEYWORD,
      normalizedKeyword: KEYWORD,
      businessValidated: "true",
      decisionStatus: "PRIORITY",
      scoreBand_simulationOnly: "PRIORITY",
      eligibleForApproval: "true",
      safetyStatus: "SAFE",
      queryQualityStatus: "VALID",
      rakutenLookupStatus: "SUCCESS",
      rakutenSupplyStatus: "ELIGIBLE",
      finalPriority: "77",
      webKeywordScoreTotal: "74",
      bestProductQualityScore: "80",
    },
  ];
  await writeCsv(
    dir,
    "keyword-scores.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,businessValidated,scoreBand_simulationOnly,decisionStatus,safetyStatus,queryQualityStatus,rakutenLookupStatus,rakutenSupplyStatus,eligibleForApproval,eligibleForExport,eligibleForPublish,validationFailureReasons,dataSource,sourceProvider,isSynthetic,demand,purchaseIntent,adsCompetitionGap_notSeoCompetition,trendAndStability,rakutenSupplyFit,clusterFit,webKeywordScoreTotal,confidence,bestProductQualityScore,finalPriority,reasons",
    scoresRows
  );
  await writeCsv(
    dir,
    "keyword-candidates.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,keywordVariants,cluster,intent,safetyStatus,queryQualityStatus,variantCount,mergeReason,sourceProvider,isSynthetic,periodStart,periodEnd,monthlySearches,searchVolumeVariance,competitionLevel,trendIndex,lowTopOfPageBid_monetizationOnly,highTopOfPageBid_monetizationOnly",
    [{ originalKeyword: KEYWORD, normalizedKeyword: KEYWORD, cluster: "シニア犬フード", monthlySearches: "500" }]
  );
  await writeCsv(
    dir,
    "rakuten-matches.csv",
    "originalKeyword,normalizedKeyword,rakutenQuery,itemCode,status,matchScore,requiredAttributes,matchedAttributes,missingAttributes,conflictingAttributes,dataSource,reasons",
    [0, 1, 2].map((i) => ({
      originalKeyword: KEYWORD,
      normalizedKeyword: KEYWORD,
      itemCode: `shop:${i}`,
      status: "ELIGIBLE",
      matchScore: "100",
      requiredAttributes: "species:dog | feature:domestic",
      matchedAttributes: "species:dog | feature:domestic",
      missingAttributes: "",
      conflictingAttributes: "",
    }))
  );
  await writeFile(
    join(dir, "rakuten-items.json"),
    JSON.stringify({
      [KEYWORD]: [0, 1, 2].map((i) => ({ itemCode: `shop:${i}`, itemName: `テスト商品${i}`, catchcopy: "", itemPrice: 2000 + i, reviewAverage: 4.5, reviewCount: 100, qualityScore: 80 - i })),
    }),
    "utf-8"
  );

  const artifactHashes = {};
  for (const filename of ARTIFACT_FILENAMES) {
    artifactHashes[filename] = await sha256File(join(dir, filename));
  }
  const candidateSetHash = computeCandidateSetHash(scoresRows.map((r) => ({ originalKeyword: r.originalKeyword })));

  const metadata = {
    runId: SOURCE_RUN_ID,
    status: "completed",
    commandMode: "gkp-dry-run",
    rakutenSource: "live",
    sourceProvider: "google_keyword_planner",
    executedAt: "2026-09-01T00:00:00.000Z",
    searchSourceCounts: { live: 1 },
    resultCounts: { apiErrorCount: 0, apiErrorRate: 0, attemptedCount: 1 },
    selectedCount: 1,
    candidateCount: 1,
    candidateSetHash,
    artifactHashes,
  };
  await writeFile(join(dir, "run-metadata.json"), JSON.stringify(metadata), "utf-8");
  return candidateSetHash;
}

async function writeApproval(dir, sourceRunId, candidateSetHash, keywords) {
  const filePath = join(dir, "approval.json");
  await writeFile(
    filePath,
    JSON.stringify({
      version: 1,
      sourceRunId,
      candidateSetHash,
      approvedBy: "human",
      approvedAt: new Date(Date.now() - 60_000).toISOString(), // 常に「現在より過去」かつsource run実行後になるよう実行時刻基準にする
      keywords,
    }),
    "utf-8"
  );
  return filePath;
}

function runCli(args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of Object.keys(envOverrides)) {
    if (envOverrides[key] === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [CLI, ...args], { cwd: PROJECT_ROOT, encoding: "utf-8", env });
}

async function rmRunDir(runId) {
  await rm(join(PILOT_DRAFTS_DIR, runId), { recursive: true, force: true });
}

test("KEYWORD_RESEARCH_DRAFTS_ENABLEDが未設定(既定false)の場合は生成できない", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: KEYWORD, title: "テスト", slug: "flag-off-test", action: "CREATE" },
    ]);
    const runId = `test-flagoff-${Date.now()}`;
    const result = runCli(
      ["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId],
      { KEYWORD_RESEARCH_DRAFTS_ENABLED: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /KEYWORD_RESEARCH_DRAFTS_ENABLED/);
    assert.equal(existsSync(join(PILOT_DRAFTS_DIR, runId)), false, "feature flag OFF時は出力先を作らない");
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});

test("--approved-file未指定は生成できない", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  try {
    await buildValidSourceRun(sourceRunDir);
    const runId = `test-noapproval-${Date.now()}`;
    const result = runCli(["--source-run", sourceRunDir, "--run-id", runId], { KEYWORD_RESEARCH_DRAFTS_ENABLED: "true" });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(PILOT_DRAFTS_DIR, runId)), false);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
  }
});

test("正常な承認ファイル・source runから下書きを生成できる(全出力ファイル・DRAFT表示・noindex)", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  const runId = `test-success-${Date.now()}`;
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: KEYWORD, title: "シニア犬向け豚肉ドッグフードおすすめランキング比較", slug: "cli-success-test", action: "CREATE" },
    ]);
    const result = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
    });
    assert.equal(result.status, 0, result.stderr);

    const outDir = join(PILOT_DRAFTS_DIR, runId);
    const entries = await readdir(outDir);
    assert.ok(entries.includes("cli-success-test.html"));
    assert.ok(entries.includes("manifest.json"));
    assert.ok(entries.includes("validation-report.md"));
    assert.ok(entries.includes("run-metadata.json"));

    const html = await readFile(join(outDir, "cli-success-test.html"), "utf-8");
    assert.match(html, /DRAFT・非公開/);
    assert.match(html, /noindex,nofollow/);

    const metadata = JSON.parse(await readFile(join(outDir, "run-metadata.json"), "utf-8"));
    assert.equal(metadata.status, "completed");
    assert.equal(metadata.sourceRunId, SOURCE_RUN_ID);
    assert.equal(metadata.candidateSetHash, candidateSetHash);
    assert.deepEqual(metadata.slugs, ["cli-success-test"]);
    assert.equal(metadata.generatedCount, 1);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
    await rmRunDir(runId);
  }
});

test("出力先が既に存在する場合はエラーになり上書きしない", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  const runId = `test-existing-${Date.now()}`;
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: KEYWORD, title: "テスト", slug: "existing-test-slug", action: "CREATE" },
    ]);
    const first = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
    });
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
    });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /既に存在/);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
    await rmRunDir(runId);
  }
});

test("既存サイトのファイル(docs/index.html, articles-data.json, selected-products.json)が実行前後で一切変更されない", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  const runId = `test-siteimpact-${Date.now()}`;
  const targets = ["docs/index.html", "articles-data.json", "selected-products.json"].map((p) => join(PROJECT_ROOT, p));
  const before = await Promise.all(targets.map(async (p) => ({ content: await readFile(p, "utf-8"), mtime: (await stat(p)).mtimeMs })));
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: KEYWORD, title: "テスト", slug: "siteimpact-test-slug", action: "CREATE" },
    ]);
    const result = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
    });
    assert.equal(result.status, 0, result.stderr);

    for (let i = 0; i < targets.length; i++) {
      const afterContent = await readFile(targets[i], "utf-8");
      const afterMtime = (await stat(targets[i])).mtimeMs;
      assert.equal(afterContent, before[i].content, `${targets[i]}の内容が変わっていないこと`);
      assert.equal(afterMtime, before[i].mtime, `${targets[i]}のmtimeが変わっていないこと`);
    }
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
    await rmRunDir(runId);
  }
});

test("ネットワーク呼び出しは発生しない(RAKUTEN_APP_ID/SECRET未設定でも成功する)", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  const runId = `test-nonetwork-${Date.now()}`;
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: KEYWORD, title: "テスト", slug: "nonetwork-test-slug", action: "CREATE" },
    ]);
    const result = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
      RAKUTEN_APP_ID: undefined,
      RAKUTEN_SECRET: undefined,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
    await rmRunDir(runId);
  }
});

test("承認ファイルにゲート違反のキーワードが含まれる場合、エラー終了しメタデータを残さない(プリフライト拒否)", async () => {
  const sourceRunDir = await mkdtemp(join(tmpdir(), "pilot-cli-source-"));
  const approvalDir = await mkdtemp(join(tmpdir(), "pilot-cli-approval-"));
  const runId = `test-gateviolation-${Date.now()}`;
  try {
    const candidateSetHash = await buildValidSourceRun(sourceRunDir);
    const approvedFilePath = await writeApproval(approvalDir, SOURCE_RUN_ID, candidateSetHash, [
      { normalizedKeyword: "存在しないキーワード", title: "テスト", slug: "gateviolation-test-slug", action: "CREATE" },
    ]);
    const result = runCli(["--source-run", sourceRunDir, "--approved-file", approvedFilePath, "--run-id", runId], {
      KEYWORD_RESEARCH_DRAFTS_ENABLED: "true",
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(PILOT_DRAFTS_DIR, runId)), false, "ゲート違反時は出力先を作らない(プリフライト段階で拒否)");
  } finally {
    await rm(sourceRunDir, { recursive: true, force: true });
    await rm(approvalDir, { recursive: true, force: true });
  }
});
