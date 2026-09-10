// 【2026-09-09 試験公開対応】keywords:publish-approved-pages CLIの統合テスト。
// 実docs/への書き込みは一切行わず、--docs-rankings-dirでテスト専用の一時ディレクトリへ
// 隔離する(このテスト自身が作成した一時ディレクトリだけを削除する)。
// 楽天/Google APIは一切呼び出さない(保存済みfixtureのみ使用)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const PUBLISH_CLI = fileURLToPath(new URL("../cli/publish-approved-pages.js", import.meta.url));

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

async function setupPublishFixture(outputRoot) {
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

test("publish-approved-pages CLI: feature flag未設定の場合は非ゼロ終了し、書き込みを一切行わない", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED/);
    const entries = await readdir(docsRankingsDir);
    assert.equal(entries.length, 0, "feature flag未設定時は何も書き込まれないこと");
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: 必須引数が無い場合は非ゼロ終了する", async () => {
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const result = runCli(PUBLISH_CLI, ["--source-run", "dummy", "--docs-rankings-dir", docsRankingsDir], { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true" });
    assert.notEqual(result.status, 0);
  } finally {
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: 出力先ファイルが既に存在する場合は上書きせず非ゼロ終了する", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    // 事前に同名ファイルを配置しておく(実運用で既存の別ページと衝突するケースを模擬)
    const { writeFile } = await import("node:fs/promises");
    const preexistingContent = "<!doctype html><html><body>既存の別ページ</body></html>";
    await writeFile(join(docsRankingsDir, `${DOG_SLUG}.html`), preexistingContent, "utf-8");

    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /既に存在/);

    // 既存ファイルの中身が変更されていないこと(上書きされていないこと)
    const stillThere = await readFile(join(docsRankingsDir, `${DOG_SLUG}.html`), "utf-8");
    assert.equal(stillThere, preexistingContent);
    // 猫ページ側も書き込まれていないこと(一部だけ公開される状態を避ける)
    assert.equal(existsSync(join(docsRankingsDir, `${CAT_SLUG}.html`)), false);
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: 全ゲート通過時は成功し、DRAFTバナー無し・noindex維持のHTMLを書き込む", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.equal(result.status, 0, result.stderr);

    const dogHtml = await readFile(join(docsRankingsDir, `${DOG_SLUG}.html`), "utf-8");
    const catHtml = await readFile(join(docsRankingsDir, `${CAT_SLUG}.html`), "utf-8");
    for (const html of [dogHtml, catHtml]) {
      assert.doesNotMatch(html, /class="draft-banner"/, "DRAFTバナーを含まないこと");
      assert.doesNotMatch(html, /下書き・非公開/, "タイトル接頭辞を含まないこと");
      assert.match(html, /noindex,nofollow/, "noindexは維持されること");
      assert.match(html, /<a class="site-title" href="https:\/\/[^"]+">/, "既存サイトと同じヘッダーリンクを含むこと");
      assert.match(html, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST12345"><\/script>/, "既存サイトと同じGA4計測タグを含むこと");
      assert.match(html, /gtag\('config','G-TEST12345'\)/);
    }
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: GA_MEASUREMENT_ID未設定の場合はfail closedで非ゼロ終了し、何も書き込まない", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: undefined }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GA_MEASUREMENT_ID/);
    const entries = await readdir(docsRankingsDir);
    assert.equal(entries.length, 0, "GA_MEASUREMENT_ID未設定時は何も書き込まれないこと");
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

// =====================================================================
// 【2026-09-10 検索公開試験対応】--enable-search-index は「既に公開済みのページ」を
// 検索公開試験用(noindex解除)に更新するための専用モード。通常モード(--enable-search-index
// なし)とは安全側の前提が逆(通常は既存なら失敗、こちらは既存でなければ失敗)。
// =====================================================================

test("publish-approved-pages CLI --enable-search-index: 出力先がまだ存在しない場合は非ゼロ終了し、新規作成しない", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir, "--enable-search-index"],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /まだ存在しません/);
    const entries = await readdir(docsRankingsDir);
    assert.equal(entries.length, 0, "未公開のページを--enable-search-indexで新規作成しないこと");
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI --enable-search-index: 既に公開済みのページを更新し、robots metaを除去する", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    // 通常モードで先に公開しておく(既存の限定公開ページを模擬)
    const publishResult = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.equal(publishResult.status, 0, publishResult.stderr);
    const beforeDogHtml = await readFile(join(docsRankingsDir, `${DOG_SLUG}.html`), "utf-8");
    assert.match(beforeDogHtml, /noindex,nofollow/);

    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir, "--enable-search-index"],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.equal(result.status, 0, result.stderr);

    const dogHtml = await readFile(join(docsRankingsDir, `${DOG_SLUG}.html`), "utf-8");
    const catHtml = await readFile(join(docsRankingsDir, `${CAT_SLUG}.html`), "utf-8");
    for (const html of [dogHtml, catHtml]) {
      assert.doesNotMatch(html, /name="robots"/, "検索公開試験ではrobots metaを出力しないこと");
      assert.doesNotMatch(html, /noindex/, "noindexを含まないこと");
      assert.doesNotMatch(html, /class="draft-banner"/, "DRAFTバナーを含まないこと(通常公開と同じ見た目を維持)");
      assert.match(html, /gtag\('config','G-TEST12345'\)/, "GA4計測タグは維持されること");
    }
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: --enable-search-indexを指定しない通常モードは、既存ページ更新後も従来通り上書きを拒否する(既定の安全側が変わらないこと)", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
    const { sourceRun, pubApprovalPath, enrichmentRun } = await setupPublishFixture(outputRoot);
    const publishResult = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.equal(publishResult.status, 0, publishResult.stderr);

    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /既に存在/);
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});

test("publish-approved-pages CLI: 在庫ゲート等の既存の安全ゲートが機能し、違反時は書き込まない", async () => {
  const outputRoot = await createOutputRoot();
  const docsRankingsDir = await mkdtemp(join(tmpdir(), "docs-rankings-test-"));
  try {
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
    // shop:d1のavailabilityを不正にし、在庫ゲートを発火させる
    const dogEnriched = ["shop:d1", "shop:d2", "shop:d3"].map((c) => enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash, ...(c === "shop:d1" ? { availability: 0 } : {}) }));
    const catEnriched = ["shop:c1", "shop:c2", "shop:c3"].map((c) => enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash }));
    const enrichmentRun = await buildFixtureEnrichmentRun(outputRoot, sourceRun, publicationApprovedFileHash, { dogEnrichedItems: dogEnriched, catEnrichedItems: catEnriched });

    const result = runCli(
      PUBLISH_CLI,
      ["--source-run", sourceRun.dir, "--publication-approved-file", pubApprovalPath, "--enrichment-run", enrichmentRun.dir, "--docs-rankings-dir", docsRankingsDir],
      { KEYWORD_RESEARCH_TRIAL_PUBLISH_ENABLED: "true", GA_MEASUREMENT_ID: "G-TEST12345" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /在庫/, "在庫ゲート違反が理由で拒否されること(GA未設定等の別理由ではない)");
    const entries = await readdir(docsRankingsDir);
    assert.equal(entries.length, 0, "ゲート違反時は何も公開されないこと(fail closed)");
  } finally {
    await cleanup(outputRoot);
    await rm(docsRankingsDir, { recursive: true, force: true });
  }
});
