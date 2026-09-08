// 【2026-09-07 Phase 3B対応】Phase 3B 3段階CLIの統合テスト(実際にサブプロセスとして起動)。
// feature flag・引数必須・出力先排他・fixture拒否・認証情報不足時のAPI呼び出し0件を検証する。
// live楽天APIは一切呼び出さない(enrich-publication-products.jsの成功パス自体はここではテストしない)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createOutputRoot,
  buildFixtureSourceRun,
  buildFixtureKeywordApprovalFile,
  buildFixtureReviewRun,
  buildFixtureEnrichmentRun,
  buildFixturePublicationApprovalFile,
  approvedProduct,
  enrichedItem,
  DOG_SLUG,
  CAT_SLUG,
} from "./helpers/phase3b-fixtures.js";

const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
const PREPARE_REVIEW_CLI = fileURLToPath(new URL("../cli/prepare-publication-review.js", import.meta.url));
const ENRICH_CLI = fileURLToPath(new URL("../cli/enrich-publication-products.js", import.meta.url));
const BUILD_PREVIEW_CLI = fileURLToPath(new URL("../cli/build-publication-preview.js", import.meta.url));

async function fileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath, "utf-8"), "utf-8").digest("hex");
}

function runCli(cliPath, args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of Object.keys(envOverrides)) {
    if (envOverrides[key] === undefined) delete env[key];
  }
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: PROJECT_ROOT, encoding: "utf-8", env });
}

async function cleanup(outputRoot) {
  await rm(outputRoot, { recursive: true, force: true });
}

// 【重要】prepare-publication-review.jsのCLIは、build-publication-preview.js(--enrichment-run
// を明示的な引数で受け取る)と異なり、出力先を常に自分自身の場所からの相対パス
// (keyword-research/output/publication-reviews/<runId>/、実リポジトリ直下)に固定している。
// --source-runにfixture用の一時ディレクトリを渡しても、レビュー資料はそこの兄弟には
// 作られない(本番では--source-runも常に同じ実リポジトリのkeyword-research/output/配下に
// あるため問題にならない)。そのためこのCLI単体のテストでは、実リポジトリ側の出力先を
// 確認・後片付けする。
async function cleanupRealReviewRun(runId) {
  await rm(`${PROJECT_ROOT}/keyword-research/output/publication-reviews/${runId}`, { recursive: true, force: true });
}

// =====================================================================
// keywords:prepare-publication-review
// =====================================================================

test("prepare-publication-review CLI: 必須引数が無い場合は非ゼロ終了する", async () => {
  const outputRoot = await createOutputRoot();
  try {
    const result = runCli(PREPARE_REVIEW_CLI, ["--source-run", "dummy"]);
    assert.notEqual(result.status, 0);
  } finally {
    await cleanup(outputRoot);
  }
});

test("prepare-publication-review CLI: 実際に成功し、3ファイルが出力される(排他作成・自動承認なし)", async () => {
  const outputRoot = await createOutputRoot();
  const runId = `cli-test-review-run-${Date.now()}`;
  try {
    const sourceRun = await buildFixtureSourceRun(outputRoot);
    const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
    const result = runCli(PREPARE_REVIEW_CLI, ["--source-run", sourceRun.dir, "--approved-file", keywordApprovalPath, "--run-id", runId]);
    assert.equal(result.status, 0, result.stderr);

    const outDir = `${PROJECT_ROOT}/keyword-research/output/publication-reviews/${runId}/`;
    const entries = await readdir(outDir);
    assert.ok(entries.includes("publication-review.md"));
    assert.ok(entries.includes("publication-candidates.json"));
    assert.ok(entries.includes("run-metadata.json"));

    const candidates = JSON.parse(await readFile(`${outDir}publication-candidates.json`, "utf-8"));
    assert.equal(candidates.sourceRunId, sourceRun.runId);
    assert.ok(candidates.pages.some((p) => p.slug === DOG_SLUG));
    assert.ok(candidates.pages.some((p) => p.slug === CAT_SLUG));

    const md = await readFile(`${outDir}publication-review.md`, "utf-8");
    assert.match(md, /内部確認専用/);

    // このCLI自体は何も自動承認しない(公開承認ファイルを作らない)
    assert.equal(existsSync(`${PROJECT_ROOT}/keyword-research/output/publication-approvals/`), false);
  } finally {
    await cleanup(outputRoot);
    await cleanupRealReviewRun(runId);
  }
});

test("prepare-publication-review CLI: 出力先が既に存在する場合はエラーになり上書きしない", async () => {
  const outputRoot = await createOutputRoot();
  const runId = `cli-test-review-existing-${Date.now()}`;
  try {
    const sourceRun = await buildFixtureSourceRun(outputRoot);
    const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
    const first = runCli(PREPARE_REVIEW_CLI, ["--source-run", sourceRun.dir, "--approved-file", keywordApprovalPath, "--run-id", runId]);
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(PREPARE_REVIEW_CLI, ["--source-run", sourceRun.dir, "--approved-file", keywordApprovalPath, "--run-id", runId]);
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /既に存在/);
  } finally {
    await cleanup(outputRoot);
    await cleanupRealReviewRun(runId);
  }
});

// =====================================================================
// keywords:enrich-publication-products(live成功パスは対象外。ガードのみ検証)
// =====================================================================

test("enrich-publication-products CLI: --rakuten-source liveを指定しないと非ゼロ終了しAPIを呼ばない", async () => {
  const result = runCli(ENRICH_CLI, ["--source-run", "dummy", "--publication-approved-file", "dummy"], {
    RAKUTEN_APP_ID: "dummy-should-not-be-used",
    RAKUTEN_SECRET: "dummy-should-not-be-used",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--rakuten-source live/);
});

test("enrich-publication-products CLI: --rakuten-source fixtureは明示的に拒否される", async () => {
  const result = runCli(ENRICH_CLI, ["--source-run", "dummy", "--publication-approved-file", "dummy", "--rakuten-source", "fixture"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--rakuten-source live/);
});

test("enrich-publication-products CLI: 認証情報未設定の場合はAPI呼び出し0件で非ゼロ終了する", async () => {
  const result = runCli(
    ENRICH_CLI,
    ["--source-run", "dummy", "--publication-approved-file", "dummy", "--rakuten-source", "live"],
    { RAKUTEN_APP_ID: undefined, RAKUTEN_SECRET: undefined }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RAKUTEN_APP_ID\/RAKUTEN_SECRET/);
  assert.match(result.stderr, /API呼び出し0件/);
});

test("enrich-publication-products CLI: 必須引数が無い場合は非ゼロ終了する", async () => {
  const result = runCli(ENRICH_CLI, ["--rakuten-source", "live"], { RAKUTEN_APP_ID: "x", RAKUTEN_SECRET: "y" });
  assert.notEqual(result.status, 0);
});

// =====================================================================
// keywords:build-publication-preview
// =====================================================================

async function setupBuildPreviewFixture(outputRoot) {
  const sourceRun = await buildFixtureSourceRun(outputRoot);
  const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
  const keywordApprovedFileHash = await fileHash(keywordApprovalPath);

  const dogCandidates = ["shop:d1", "shop:d2", "shop:d3"].map((c) => ({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false }));
  const catCandidates = ["shop:c1", "shop:c2", "shop:c3"].map((c) => ({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false }));
  const reviewRun = await buildFixtureReviewRun(outputRoot, sourceRun, keywordApprovedFileHash, { dogCandidates, catCandidates });

  const dogProducts = ["shop:d1", "shop:d2", "shop:d3"].map((c) => approvedProduct(c));
  const catProducts = ["shop:c1", "shop:c2", "shop:c3"].map((c) => approvedProduct(c));
  const { filePath: pubApprovalPath } = await buildFixturePublicationApprovalFile(outputRoot, sourceRun, keywordApprovedFileHash, reviewRun, { dogProducts, catProducts });
  const publicationApprovedFileHash = await fileHash(pubApprovalPath);

  const dogEnriched = ["shop:d1", "shop:d2", "shop:d3"].map((c) => enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash }));
  const catEnriched = ["shop:c1", "shop:c2", "shop:c3"].map((c) => enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash }));
  const enrichmentRun = await buildFixtureEnrichmentRun(outputRoot, sourceRun, publicationApprovedFileHash, { dogEnrichedItems: dogEnriched, catEnrichedItems: catEnriched });

  return { sourceRun, pubApprovalPath, enrichmentRun };
}

test("build-publication-preview CLI: feature flag未設定の場合は非ゼロ終了する", async () => {
  const outputRoot = await createOutputRoot();
  const runId = `cli-test-flagoff-${Date.now()}`;
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupBuildPreviewFixture(outputRoot);
    const result = runCli(
      BUILD_PREVIEW_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--run-id", runId],
      { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED/);
    assert.equal(existsSync(`${PROJECT_ROOT}/keyword-research/output/publication-previews/${runId}`), false);
  } finally {
    await cleanup(outputRoot);
    await rm(`${PROJECT_ROOT}/keyword-research/output/publication-previews/${runId}`, { recursive: true, force: true });
  }
});

test("build-publication-preview CLI: 全ゲート通過時は成功し、HTML・validation-report・run-metadataが出力される", async () => {
  const outputRoot = await createOutputRoot();
  const runId = `cli-test-success-${Date.now()}`;
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupBuildPreviewFixture(outputRoot);
    const result = runCli(
      BUILD_PREVIEW_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--run-id", runId],
      { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: "true" }
    );
    assert.equal(result.status, 0, result.stderr);

    const outDir = `${PROJECT_ROOT}/keyword-research/output/publication-previews/${runId}/`;
    const entries = await readdir(outDir);
    assert.ok(entries.includes(`${DOG_SLUG}.html`));
    assert.ok(entries.includes(`${CAT_SLUG}.html`));
    assert.ok(entries.includes("validation-report.md"));
    assert.ok(entries.includes("run-metadata.json"));

    const metadata = JSON.parse(await readFile(`${outDir}run-metadata.json`, "utf-8"));
    assert.equal(metadata.status, "completed");
    assert.equal(metadata.generatedCount, 2);
    assert.deepEqual(metadata.slugs.sort(), [DOG_SLUG, CAT_SLUG].sort());
  } finally {
    await cleanup(outputRoot);
    await rm(`${PROJECT_ROOT}/keyword-research/output/publication-previews/${runId}`, { recursive: true, force: true });
  }
});

test("build-publication-preview CLI: 出力先が既に存在する場合はエラーになり上書きしない", async () => {
  const outputRoot = await createOutputRoot();
  const runId = `cli-test-existing-${Date.now()}`;
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupBuildPreviewFixture(outputRoot);
    const args = ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--run-id", runId];
    const first = runCli(BUILD_PREVIEW_CLI, args, { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: "true" });
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(BUILD_PREVIEW_CLI, args, { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: "true" });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /既に存在/);
  } finally {
    await cleanup(outputRoot);
    await rm(`${PROJECT_ROOT}/keyword-research/output/publication-previews/${runId}`, { recursive: true, force: true });
  }
});

test("build-publication-preview CLI: 必須引数が無い場合は非ゼロ終了する", async () => {
  const result = runCli(BUILD_PREVIEW_CLI, ["--source-run", "dummy"], { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: "true" });
  assert.notEqual(result.status, 0);
});

// =====================================================================
// 既存サイトへの無影響・ネットワーク呼び出し0件
// =====================================================================

test("Phase 3B CLI実行前後で既存サイト(docs/index.html, articles-data.json, selected-products.json, select-products.js)が不変", async () => {
  const { stat } = await import("node:fs/promises");
  const targets = ["docs/index.html", "articles-data.json", "selected-products.json", "select-products.js"].map((p) => `${PROJECT_ROOT}/${p}`);
  const before = await Promise.all(targets.map(async (p) => ({ content: await readFile(p, "utf-8"), mtime: (await stat(p)).mtimeMs })));

  const outputRoot = await createOutputRoot();
  const reviewRunId = `cli-test-siteimpact-review-${Date.now()}`;
  const previewRunId = `cli-test-siteimpact-preview-${Date.now()}`;
  try {
    const sourceRun = await buildFixtureSourceRun(outputRoot);
    const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
    const reviewResult = runCli(PREPARE_REVIEW_CLI, ["--source-run", sourceRun.dir, "--approved-file", keywordApprovalPath, "--run-id", reviewRunId]);
    assert.equal(reviewResult.status, 0, reviewResult.stderr);

    const { sourceRun: sourceRun2, pubApprovalPath, enrichmentRun } = await setupBuildPreviewFixture(outputRoot);
    const buildResult = runCli(
      BUILD_PREVIEW_CLI,
      ["--source-run", sourceRun2.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--run-id", previewRunId],
      { KEYWORD_RESEARCH_PUBLICATION_PREVIEW_ENABLED: "true" }
    );
    assert.equal(buildResult.status, 0, buildResult.stderr);

    for (let i = 0; i < targets.length; i++) {
      const afterContent = await readFile(targets[i], "utf-8");
      const afterMtime = (await stat(targets[i])).mtimeMs;
      assert.equal(afterContent, before[i].content, `${targets[i]}の内容が変わっていないこと`);
      assert.equal(afterMtime, before[i].mtime, `${targets[i]}のmtimeが変わっていないこと`);
    }
  } finally {
    await cleanup(outputRoot);
    await cleanupRealReviewRun(reviewRunId);
    await rm(`${PROJECT_ROOT}/keyword-research/output/publication-previews/${previewRunId}`, { recursive: true, force: true });
  }
});
