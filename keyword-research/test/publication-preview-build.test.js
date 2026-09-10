// 【2026-09-07 Phase 3B対応】公開前プレビュー生成オーケストレーション
// (publication-preview-build.js)のテスト。source run・商品公開承認ファイル・レビュー資料・
// 楽天商品補完データの4つをすべて読み取り専用で突き合わせ、hash不一致・最終ゲート違反・
// 店舗/シリーズ偏りを検証する。楽天APIは一切呼ばない(すべて事前構築したfixtureのみ使用)。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildPublicationPreview } from "../publication-preview-build.js";
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

async function fileHash(filePath) {
  return createHash("sha256").update(await readFile(filePath, "utf-8"), "utf-8").digest("hex");
}

/**
 * デフォルトで全ゲートを満たす一式(source run/review/enrichment/公開承認)を組み立てる。
 * 各段の内容はoverridesで個別に上書きできる。
 */
async function setupFullFixture({
  sourceRunOverrides,
  dogCandidateOverrides = (c) => c,
  catCandidateOverrides = (c) => c,
  dogProductOverrides = (p) => p,
  catProductOverrides = (p) => p,
  dogEnrichedOverrides = (e) => e,
  catEnrichedOverrides = (e) => e,
  approvalOverrides = {},
  reviewOverrides = {},
} = {}) {
  const outputRoot = await createOutputRoot();
  const sourceRun = await buildFixtureSourceRun(outputRoot, sourceRunOverrides);
  const { filePath: keywordApprovalPath } = await buildFixtureKeywordApprovalFile(outputRoot, sourceRun);
  const keywordApprovedFileHash = await fileHash(keywordApprovalPath);

  const dogCandidates = ["shop:d1", "shop:d2", "shop:d3"].map((c) =>
    dogCandidateOverrides({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false })
  );
  const catCandidates = ["shop:c1", "shop:c2", "shop:c3"].map((c) =>
    catCandidateOverrides({ itemCode: c, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: `S-${c}`, qualityScore: 80, verifiedAttributes: [], needsFlavorSelectionNote: false })
  );
  const reviewRun = await buildFixtureReviewRun(outputRoot, sourceRun, keywordApprovedFileHash, { dogCandidates, catCandidates, ...reviewOverrides });

  const dogProducts = ["shop:d1", "shop:d2", "shop:d3"].map((c) => dogProductOverrides(approvedProduct(c)));
  const catProducts = ["shop:c1", "shop:c2", "shop:c3"].map((c) => catProductOverrides(approvedProduct(c)));
  const { filePath: pubApprovalPath } = await buildFixturePublicationApprovalFile(outputRoot, sourceRun, keywordApprovedFileHash, reviewRun, {
    dogProducts,
    catProducts,
    ...approvalOverrides,
  });
  const publicationApprovedFileHash = await fileHash(pubApprovalPath);

  const dogEnriched = ["shop:d1", "shop:d2", "shop:d3"].map((c) => dogEnrichedOverrides(enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash })));
  const catEnriched = ["shop:c1", "shop:c2", "shop:c3"].map((c) => catEnrichedOverrides(enrichedItem(c, { sourceRunId: sourceRun.runId, publicationApprovedFileHash })));
  const enrichmentRun = await buildFixtureEnrichmentRun(outputRoot, sourceRun, publicationApprovedFileHash, { dogEnrichedItems: dogEnriched, catEnrichedItems: catEnriched });

  return { outputRoot, sourceRun, pubApprovalPath, enrichmentRun };
}

async function cleanup(outputRoot) {
  await rm(outputRoot, { recursive: true, force: true });
}

test("すべてのゲートを満たす場合は生成に成功する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.drafts.length, 2);
    assert.ok(result.drafts.some((d) => d.slug === DOG_SLUG));
    assert.ok(result.drafts.some((d) => d.slug === CAT_SLUG));
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-09 試験公開対応】isDraft:falseのとき、DRAFTバナー・タイトル接頭辞を
// 出さないが、noindex,nofollowは常に維持する。全ゲート・検証ロジックは
// isDraftの値に関わらず完全に同一(安全性は一切緩めない)。
// =====================================================================

test("isDraft:falseの場合、DRAFTバナー・タイトル接頭辞を出力しないが、noindex,nofollowは維持する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir, isDraft: false });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /class="draft-banner"/);
    assert.doesNotMatch(html, /下書き・非公開/);
    assert.match(html, /noindex,nofollow/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("isDraft未指定(既定値)の場合は従来通りDRAFTバナー・タイトル接頭辞を出力する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /class="draft-banner"/);
    assert.match(html, /下書き・非公開/);
    assert.match(html, /noindex,nofollow/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("isDraft:falseでも、availability=0等の既存ゲートは通常通り機能する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => (e.itemCode === "shop:d1" ? { ...e, availability: 0 } : e),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir, isDraft: false });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-09 GA4計測対応】isDraft:falseかつgaMeasurementIdが渡された場合のみ、
// 既存サイトと同じgtag.js読込・dataLayer初期化スクリプトを出力する。新しいGA4
// プロパティは作成せず、渡された値をそのまま使うだけ。DRAFTでは常に出力しない
// (内部レビュー閲覧が実際の計測に混入しないようにするため)。
// =====================================================================

test("isDraft:false かつ gaMeasurementId指定時、既存サイトと同じgtag.jsタグを出力する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({
      sourceRunDir: sourceRun.dir,
      publicationApprovedFilePath: pubApprovalPath,
      enrichmentRunDir: enrichmentRun.dir,
      isDraft: false,
      gaMeasurementId: "G-TEST12345",
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TEST12345"><\/script>/);
    assert.match(html, /gtag\('config','G-TEST12345'\)/);
    assert.match(html, /window\.dataLayer=window\.dataLayer\|\|\[\]/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("isDraft:false でも gaMeasurementId未指定なら計測タグを出力しない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir, isDraft: false });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /googletagmanager\.com/);
    assert.doesNotMatch(html, /dataLayer/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("isDraft:true(DRAFT)では、gaMeasurementIdが指定されていても計測タグを出力しない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({
      sourceRunDir: sourceRun.dir,
      publicationApprovedFilePath: pubApprovalPath,
      enrichmentRunDir: enrichmentRun.dir,
      isDraft: true,
      gaMeasurementId: "G-TEST12345",
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /googletagmanager\.com/);
    assert.doesNotMatch(html, /G-TEST12345/);
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-10 検索公開試験対応】allowSearchIndex:trueかつisDraft:falseの場合のみ、
// robots meta(noindex,nofollow)を出力しない(通常の公開ページと同じ挙動)。
// isDraft:trueのときはallowSearchIndexの値に関わらず常にnoindex,nofollowを維持する
// (下書きレビュー用ページが誤って検索エンジンに見つかることを二重に防ぐ)。
// =====================================================================

test("isDraft:false かつ allowSearchIndex:true の場合、robots metaを出力しない(検索エンジンへの公開を許可)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({
      sourceRunDir: sourceRun.dir,
      publicationApprovedFilePath: pubApprovalPath,
      enrichmentRunDir: enrichmentRun.dir,
      isDraft: false,
      allowSearchIndex: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /noindex/);
    assert.doesNotMatch(html, /name="robots"/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("allowSearchIndex:trueでも、isDraft:true(既定値)のままなら noindex,nofollowを維持する(defense in depth)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({
      sourceRunDir: sourceRun.dir,
      publicationApprovedFilePath: pubApprovalPath,
      enrichmentRunDir: enrichmentRun.dir,
      allowSearchIndex: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /noindex,nofollow/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("allowSearchIndex未指定(既定false)の場合、isDraft:falseでもnoindex,nofollowを維持する(安全側デフォルト)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({
      sourceRunDir: sourceRun.dir,
      publicationApprovedFilePath: pubApprovalPath,
      enrichmentRunDir: enrichmentRun.dir,
      isDraft: false,
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /noindex,nofollow/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("商品公開承認ファイルのcandidateSetHashがsource runと不一致なら拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    approvalOverrides: {},
  });
  // 承認ファイルを直接書き換えてcandidateSetHashを壊す
  const raw = JSON.parse(await readFile(pubApprovalPath, "utf-8"));
  raw.candidateSetHash = "tampered-hash";
  await writeFile(pubApprovalPath, JSON.stringify(raw), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /candidateSetHash/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("レビュー資料のreviewHashが再計算結果と一致しない場合(改変)は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  // レビュー資料の内容を後から改変(publicationReviewHash不一致を発生させる)
  const raw = JSON.parse(await readFile(pubApprovalPath, "utf-8"));
  const reviewRunDir = `${outputRoot}publication-reviews/${raw.reviewRunId}/`;
  const reviewCandidatesPath = `${reviewRunDir}publication-candidates.json`;
  const reviewRaw = JSON.parse(await readFile(reviewCandidatesPath, "utf-8"));
  reviewRaw.pages[0].candidates.push({ itemCode: "shop:tampered", itemPrice: 1, reviewAverage: 1, reviewCount: 1, shopName: "x", qualityScore: 1, verifiedAttributes: [], needsFlavorSelectionNote: false });
  await writeFile(reviewCandidatesPath, JSON.stringify(reviewRaw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /reviewHash|publicationReviewHash/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("補完データのenrichmentArtifactHashが記録値と一致しない場合(改変)は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG][0].itemPrice = 999999; // 保存後に改変
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /enrichmentArtifactHash|改変/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("補完データのrakutenSourceがliveでない(fixture混入)場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const raw = JSON.parse(await readFile(metaPath, "utf-8"));
  raw.rakutenSource = "fixture";
  await writeFile(metaPath, JSON.stringify(raw, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /rakutenSource|live/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("approvedAtがレビュー資料生成日時より前の場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    approvalOverrides: { approvedAt: "2020-01-01T00:00:00.000Z" },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /approvedAt/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("source runに存在しないitemCodeが承認されている場合は拒否する", async () => {
  // 承認ファイル構築の時点でsource runに無いitemCodeを含めておく(構築後にファイルを
  // 直接書き換えるとpublicationApprovedFileHashが変わってしまい、hash不一致エラーが
  // 先に発生してしまうため、fixture構築の入口で不整合を作る)。
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogProductOverrides: (p) => (p.itemCode === "shop:d1" ? { ...p, itemCode: "shop:does-not-exist" } : p),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /source runに存在しません/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("楽天最新結果(補完データ)に存在しないitemCodeが承認されている場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG] = raw[DOG_SLUG].filter((i) => i.itemCode !== "shop:d1");
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  // enrichmentArtifactHashを再計算して整合させる(改変検知テストではなく、欠損データのテストのため)
  const { sha256File } = await import("../hash-utils.js");
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));
  meta.artifactHashes["enrichment-items.json"] = await sha256File(itemsPath);
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /楽天最新結果/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("最終ゲートで動物種矛盾が再検出された場合は拒否する(defense in depth)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "猫用 グレインフリー キャットフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 80 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 80 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /商品関連性ゲート/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("最終ゲートで医療語彙が再検出された場合は拒否する(defense in depth)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "食べれば病気が治る豚肉シニア犬用ドッグフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 80 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 80 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /安全性ゲート|MEDICAL_REVIEW_REQUIRED/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("同一店舗が上限(2件)を超える場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => ({ ...e, shopName: "同じ店" }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /同一店舗/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("同一シリーズ商品が3件以上の場合は拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "グリーンプラス ドライフード ドッグフード チキン/ポーク/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "グリーンプラス ドライフード ドッグフード ビーフ/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "グリーンプラス ドライフード ドッグフード 魚/豚肉 1kg入 シニア犬用", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /同一シリーズ/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("生成されたHTMLはDRAFTバナー・noindex・画像・CTA・rel属性を含み、内部情報を含まない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;

    assert.match(html, /DRAFT/);
    assert.match(html, /noindex,nofollow/);
    assert.match(html, /<img class="product-image"/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /width="200" height="200"/);
    assert.match(html, /rel="sponsored noopener noreferrer"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /楽天市場で在庫・価格を確認してください/);
    assert.match(html, /広告・PR/);

    assert.doesNotMatch(html, /シニア 犬 豚肉/); // normalizedKeyword
    assert.doesNotMatch(html, /WebKeywordScore/);
    assert.doesNotMatch(html, /FinalPriority/);
    assert.doesNotMatch(html, /candidateSetHash/);
    assert.doesNotMatch(html, /approvedFileHash/i);
    assert.doesNotMatch(html, /reviewHash/i);
    assert.doesNotMatch(html, /phase3b-test-source-run/); // sourceRunId
    assert.doesNotMatch(html, /\bqualityScore\b/i);
    assert.doesNotMatch(html, /2026-09-07T/); // ISO日時
    assert.match(html, /\d{4}年\d{1,2}月\d{1,2}日時点/); // 日本語日付
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<!--/); // HTMLコメント自体を使わない
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-08 プレビューUI改善対応】内部slug・runId等の非表示、DRAFTバナーの
// 位置・回数、犬ページの表示順位(ポーク確定商品を優先)、選択注意文の有無、
// カード/比較表のレイアウト安全性(過大な固定高さ・画面外へはみ出す配置がない)、
// CTAのrel属性を検証する回帰テスト。
// =====================================================================

test("内部slugがHTMLに存在しない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    for (const draft of result.drafts) {
      assert.doesNotMatch(draft.html, new RegExp(DOG_SLUG.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
      assert.doesNotMatch(draft.html, new RegExp(CAT_SLUG.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")));
    }
  } finally {
    await cleanup(outputRoot);
  }
});

test("runId・itemCode・内部ファイルパスなどの内部情報がHTMLに存在しない", async () => {
  // 【重要】fixtureのapprovedProduct()既定displayName(「テスト表示名shop:d1」)は
  // itemCodeをそのまま含んでしまうため、この検証ではitemCodeを含まない
  // displayNameへ上書きし、テンプレート自身がitemCodeを漏らしていないことだけを検証する。
  const shopNames = { "shop:d1": "テストペットショップA", "shop:d2": "テストペットショップB", "shop:d3": "テストペットショップC" };
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogProductOverrides: (p) => ({ ...p, displayName: "犬用シニアドッグフード商品" }),
    dogEnrichedOverrides: (e) => ({ ...e, shopName: shopNames[e.itemCode] }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    // affiliateUrlのhref値には実際の商品ページ遷移先を示すURLエンコード済みパスが
    // 正当な理由で含まれる(これはリンク先として機能上必要なものであり、利用者向け
    // 表示テキストへのitemCode漏えいとは別の話)。そのためhref属性値は除外したうえで、
    // 画面表示テキスト側にitemCodeが出現していないことを検証する。
    const htmlWithoutHrefValues = html.replace(/href="[^"]*"/g, 'href="(omitted)"');
    assert.doesNotMatch(htmlWithoutHrefValues, /shop:d1|shop:d2|shop:d3/); // itemCode(表示テキスト側)
    assert.doesNotMatch(html, /phase3b-test-(review|enrichment)/); // reviewRunId/enrichmentRunId
    assert.doesNotMatch(html, /[A-Za-z]:[\\/](Users|home)/i); // 内部ファイルパス
    assert.doesNotMatch(html, /keyword-research[\\/]output/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("DRAFTバナーがページ最上部(header要素より前)に1回だけ存在する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const bannerMatches = html.match(/class="draft-banner"/g) || [];
    assert.equal(bannerMatches.length, 1, "DRAFTバナーは1回だけ存在すること");
    const bodyIdx = html.indexOf("<body>");
    const bannerIdx = html.indexOf('class="draft-banner"');
    const headerIdx = html.indexOf("<header>");
    assert.ok(bodyIdx < bannerIdx && bannerIdx < headerIdx, "DRAFTバナーはheader要素より前(ページ最上部)にあること");
    assert.match(html, /公開前確認用/);
    assert.match(html, /検索エンジン/);
  } finally {
    await cleanup(outputRoot);
  }
});

// 【2026-09-09 監査対応】既存サイト(docs/index.html・docs/rankings/*.html)は
// ヘッダーを<a class="site-title">(リンク)、フッターを2段落(アフィリエイト開示+
// 運営者情報)で構成している。以前のドラフトは<span>(非リンク)・1段落のみで、
// 「似た独自HTML」に留まっていたため、実際に存在する既存サイトの構造(要素種別・
// リンクの有無・フッター段落数)に合わせる。ヘッダーのリンク先は本番公開済みの
// サイトURL(固定文字列)であり、リンク切れは発生しない。generate-site.jsは
// 呼び出さない(値の再利用のみ)。
test("ヘッダーは既存サイトと同じ<a class=\"site-title\">構造で、リンク切れが無い", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const headerMatch = html.match(/<header>([\s\S]*?)<\/header>/);
    assert.ok(headerMatch, "header要素が存在すること");
    assert.match(headerMatch[1], /<a class="site-title" href="https:\/\/[^"]+">楽天トレンドセレクト<\/a>/, "既存サイトと同じくheader内はリンク(<a>)であること");
  } finally {
    await cleanup(outputRoot);
  }
});

test("フッターは既存サイトと同じく2段落(アフィリエイト開示+運営者情報)で構成される", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const footerMatch = html.match(/<footer>([\s\S]*?)<\/footer>/);
    assert.ok(footerMatch, "footer要素が存在すること");
    const paragraphs = footerMatch[1].match(/<p>/g) || [];
    assert.equal(paragraphs.length, 2, "既存サイトと同じくフッターは2段落であること");
    assert.match(footerMatch[1], /運営者/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("商品カードに過大な固定高さ・大きなmin-heightが無い", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /\.product-card\s*\{[^}]*min-height/s);
    assert.doesNotMatch(html, /\.product-card\s*\{[^}]*\bheight\s*:/s);
  } finally {
    await cleanup(outputRoot);
  }
});

test("順位ラベル(rank-badge)に画面外へ出る負の位置指定が無い", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const rankBlocks = [...html.matchAll(/\.rank-badge\s*\{([^}]*)\}/gs)].map((m) => m[1]);
    assert.ok(rankBlocks.length > 0, ".rank-badgeのCSS定義が見つかること");
    for (const block of rankBlocks) {
      assert.doesNotMatch(block, /(?:top|left|right|bottom)\s*:\s*-/, "rank-badgeのtop/left/right/bottomに負の値を使わないこと");
    }
  } finally {
    await cleanup(outputRoot);
  }
});

test("比較表にはCTAのrel属性がなく、data-labelでスマートフォン表示に対応する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /<td data-label="順位">/);
    assert.match(html, /<td data-label="商品名">/);
    assert.match(html, /max-width:\s*640px/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("商品順位はQuality Score降順である", async () => {
  const scores = { "shop:d1": 60, "shop:d2": 90, "shop:d3": 75 };
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: scores["shop:d1"] },
        { itemCode: "shop:d2", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: scores["shop:d2"] },
        { itemCode: "shop:d3", itemName: "ガンマファーム直送 豚肉メインの高齢犬用総合栄養食", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: scores["shop:d3"] },
      ],
    },
    dogProductOverrides: (p) => ({ ...p, displayName: `表示名-${p.itemCode}` }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const idxD2 = html.indexOf("表示名-shop:d2"); // qualityScore 90(最高)
    const idxD3 = html.indexOf("表示名-shop:d3"); // qualityScore 75
    const idxD1 = html.indexOf("表示名-shop:d1"); // qualityScore 60(最低)
    assert.ok(idxD2 < idxD3 && idxD3 < idxD1, "Quality Score降順で並んでいること");
  } finally {
    await cleanup(outputRoot);
  }
});

test("複数フレーバー豚肉選択商品には固定の注意文が強制表示される", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "選べる5種類 豚肉 鶏肉 牛肉 シニア犬用 ドッグフード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.match(html, /購入時にポーク／豚肉タイプを選択してください/);
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-08 表示順位改善】商品自体の内容が確定している商品(needsFlavorSelectionNote=false)を、
// 購入時にタイプ選択が必要な商品(needsFlavorSelectionNote=true)より優先して表示する。
// 既存のneedsFlavorSelectionNote()(itemNameから機械的に判定する既存の構造化ロジック)を
// そのまま使い、新たな不安定な文字列判定は追加しない。
// =====================================================================

test("犬ページの1位はポーク確定商品(選択式商品よりQuality Scoreが低くても優先される)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        // 確定商品(選択式フレーズなし)。Quality Scoreは選択式2商品より低い。
        { itemCode: "shop:d1", itemName: "グリーンプラス ドライドッグフード ポーク 全ステージ対応シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 58 },
        // 選択式商品(複数タンパク源から選べる)。Quality Scoreは確定商品より高い。
        { itemCode: "shop:d2", itemName: "国産無添加 選べるドッグフード 豚肉 牛肉 鶏肉 魚 シニア犬用お試しセット", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 78 },
        { itemCode: "shop:d3", itemName: "わんこのきちんとごはん 選べる6袋セット 豚肉 魚 シニア犬用小粒フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 64 },
      ],
    },
    dogProductOverrides: (p) => ({ ...p, displayName: `確定または選択-${p.itemCode === "shop:d1" ? "confirmed" : "selectable"}-${p.itemCode.slice(-1)}` }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const idxConfirmed = html.indexOf("確定または選択-confirmed-1"); // shop:d1(確定, QS58)
    const idxSelectableHigh = html.indexOf("確定または選択-selectable-2"); // shop:d2(選択式, QS78)
    const idxSelectableLow = html.indexOf("確定または選択-selectable-3"); // shop:d3(選択式, QS64)
    assert.ok(idxConfirmed >= 0 && idxSelectableHigh >= 0 && idxSelectableLow >= 0, "3商品すべてがHTMLに含まれること");
    assert.ok(
      idxConfirmed < idxSelectableHigh && idxConfirmed < idxSelectableLow,
      "Quality Scoreが低くても、確定商品(shop:d1)が選択式商品より先に表示されること"
    );
    assert.ok(idxSelectableHigh < idxSelectableLow, "選択式商品どうしはQuality Score降順(78→64)であること");

    const rank1 = html.match(/<div class="rank-badge">1位<\/div>[\s\S]{0,600}?確定または選択-(\w+)-\d/);
    assert.ok(rank1 && rank1[1] === "confirmed", "1位バッジの直後に表示される商品が確定商品であること");
  } finally {
    await cleanup(outputRoot);
  }
});

test("選択式2商品には選択注意文が表示され、ポーク確定商品には表示されない", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "グリーンプラス ドライドッグフード ポーク 全ステージ対応シニア犬用ごはん", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 90 },
        { itemCode: "shop:d2", itemName: "国産無添加 選べるドッグフード 豚肉 牛肉 鶏肉 魚 シニア犬用お試しセット", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 78 },
        { itemCode: "shop:d3", itemName: "わんこのきちんとごはん 選べる6袋セット 豚肉 魚 シニア犬用小粒フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 64 },
      ],
    },
    dogProductOverrides: (p) => ({ ...p, displayName: `注意文検証-${p.itemCode.slice(-1)}` }),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    const noteCount = (html.match(/購入時にポーク／豚肉タイプを選択してください/g) || []).length;
    assert.equal(noteCount, 2, "選択式2商品にのみ選択注意文が表示されること");

    // 確定商品(shop:d1、displayName「注意文検証-1」)の直後に注意文が現れないことを確認する
    const confirmedIdx = html.indexOf("注意文検証-1");
    const nextCardIdx = html.indexOf("product-card", confirmedIdx + 1);
    const confirmedCardHtml = html.slice(confirmedIdx, nextCardIdx > 0 ? nextCardIdx : undefined);
    assert.doesNotMatch(confirmedCardHtml, /product-note/, "確定商品のカードに注意文(product-note)が含まれないこと");
  } finally {
    await cleanup(outputRoot);
  }
});

// =====================================================================
// 【2026-09-08 在庫ゲート対応】段階Cの独立した在庫再検証(多層防御)。
// 段階B(enrich-publication-products)の判定結果をそのまま信用せず、
// enrichment-items.json自体のavailabilityを段階Cが独立して再チェックする。
// 人間承認済み(product.humanApproved=true)であっても在庫ゲートは回避できない。
// =====================================================================

test("段階Cの独立した在庫再検証: enrichment-items.jsonのavailability=0は最終ゲートで拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => (e.itemCode === "shop:d1" ? { ...e, availability: 0 } : e),
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("段階Cの独立した在庫再検証: availabilityが欠損している(在庫ゲート導入前の古い形式)場合も拒否する", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    dogEnrichedOverrides: (e) => {
      if (e.itemCode !== "shop:d1") return e;
      const { availability, ...rest } = e;
      return rest;
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("段階Cの独立した在庫再検証: 事後改変でavailability=0にしartifactHashを再計算・整合させても拒否する(hash一致だけでは見逃す欠陥がないことの確認)", async () => {
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture();
  const itemsPath = `${enrichmentRun.dir}enrichment-items.json`;
  const raw = JSON.parse(await readFile(itemsPath, "utf-8"));
  raw[DOG_SLUG] = raw[DOG_SLUG].map((i) => (i.itemCode === "shop:d1" ? { ...i, availability: 0 } : i));
  await writeFile(itemsPath, JSON.stringify(raw, null, 2), "utf-8");
  // artifactHashを実ファイルに合わせて再計算(改変検知=hash不一致ではなく、
  // 「hashは一致しているのにavailabilityが不正」という独立ゲートの効果を検証するため)
  const { sha256File } = await import("../hash-utils.js");
  const metaPath = `${enrichmentRun.dir}run-metadata.json`;
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));
  meta.artifactHashes["enrichment-items.json"] = await sha256File(itemsPath);
  await writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.errors.join(""), /改変の可能性/, "hash不一致としてではなく、独立した在庫ゲートとして拒否されること");
    assert.match(result.errors.join(""), /在庫/);
  } finally {
    await cleanup(outputRoot);
  }
});

test("catchcopyはHTMLへ一切出力されない", async () => {
  const secretCatchcopy = "これは絶対に出力されてはいけない販売者コピーXYZ777";
  const { outputRoot, sourceRun, pubApprovalPath, enrichmentRun } = await setupFullFixture({
    sourceRunOverrides: {
      dogItemsOverride: [
        { itemCode: "shop:d1", itemName: "アルファブランド 豚肉レシピ シニア犬用ごはん", catchcopy: secretCatchcopy, itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S1", qualityScore: 80 },
        { itemCode: "shop:d2", itemName: "ベータキッチン特製 老犬向け豚肉フード", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S2", qualityScore: 79 },
        { itemCode: "shop:d3", itemName: "ガンマファーム直送 豚肉メインの高齢犬用総合栄養食", catchcopy: "", itemPrice: 3000, reviewAverage: 4.5, reviewCount: 100, shopName: "S3", qualityScore: 78 },
      ],
    },
  });
  try {
    const result = await buildPublicationPreview({ sourceRunDir: sourceRun.dir, publicationApprovedFilePath: pubApprovalPath, enrichmentRunDir: enrichmentRun.dir });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const html = result.drafts.find((d) => d.slug === DOG_SLUG).html;
    assert.doesNotMatch(html, /XYZ777/);
  } finally {
    await cleanup(outputRoot);
  }
});
